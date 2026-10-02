import type {
  BrowserImportCategory,
  BrowserImportData,
  ImportedLogin,
} from "../../../shared/browser-import";
import type { AutomationPage } from "./automation-driver";
import { parseBrowserImportFile } from "./import-parsers";
import { readBrowserImportSource } from "./import-sources";
import { browserImportStore, type BrowserImportCounts } from "./import-store";
import { applyImportedBrowserCookies, getPageById } from "./pw-manager";
import { getBrowserSupervisionSettings, getBrowserSupervisionStatus } from "./supervision";

const CATEGORIES: BrowserImportCategory[] = ["passwords", "cookies", "history", "bookmarks"];
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
let importing = false;

interface BrowserImportRequest {
  categories: BrowserImportCategory[];
  source_id?: string;
  files: Partial<Record<BrowserImportCategory, string>>;
}

export function validateBrowserImportRequest(body: unknown): BrowserImportRequest {
  if (!body || typeof body !== "object" || !("consent" in body) || body.consent !== true) {
    throw new Error("Confirm that you want to import the selected browser data.");
  }
  if (
    !("categories" in body) ||
    !Array.isArray(body.categories) ||
    body.categories.length === 0 ||
    body.categories.length > CATEGORIES.length
  ) {
    throw new Error("Choose at least one browser data category.");
  }
  const categories: BrowserImportCategory[] = [];
  for (const category of body.categories) {
    if (typeof category !== "string" || !CATEGORIES.includes(category as BrowserImportCategory))
      throw new Error("Unsupported browser data category.");
    if (categories.includes(category as BrowserImportCategory))
      throw new Error("Duplicate browser data category.");
    categories.push(category as BrowserImportCategory);
  }
  const source = "source_id" in body ? body.source_id : undefined;
  if (source !== undefined && (typeof source !== "string" || !/^[a-f0-9]{32,64}$/.test(source)))
    throw new Error("Invalid browser source.");
  const rawFiles = "files" in body ? body.files : {};
  if (!rawFiles || typeof rawFiles !== "object" || Array.isArray(rawFiles))
    throw new Error("Invalid import files.");
  const files: Partial<Record<BrowserImportCategory, string>> = {};
  let totalBytes = 0;
  for (const [key, value] of Object.entries(rawFiles)) {
    if (!categories.includes(key as BrowserImportCategory) || typeof value !== "string")
      throw new Error("Upload files only for selected categories.");
    totalBytes += Buffer.byteLength(value, "utf8");
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Import files exceed the 24 MB total limit.");
    files[key as BrowserImportCategory] = value;
  }
  for (const category of categories) {
    if (
      files[category] === undefined &&
      (!source || category === "passwords" || category === "cookies")
    ) {
      throw new Error(
        `Choose an exported ${category} file. Protected passwords and cookies cannot be read directly from your browser.`
      );
    }
  }
  return { categories, source_id: typeof source === "string" ? source : undefined, files };
}

export async function importBrowserData(
  body: unknown
): Promise<{ imported: BrowserImportCounts; warnings: string[] }> {
  const request = validateBrowserImportRequest(body);
  if (importing) throw new Error("Another browser import is running. Wait for it to finish.");
  importing = true;
  try {
    const data: BrowserImportData = { passwords: [], cookies: [], history: [], bookmarks: [] };
    const sourceCategories = request.categories.filter(
      (category) => request.files[category] === undefined
    );
    if (request.source_id && sourceCategories.length > 0) {
      const source = await readBrowserImportSource(request.source_id, sourceCategories);
      for (const category of sourceCategories)
        Object.assign(data, { [category]: source[category] });
    }
    for (const category of request.categories) {
      const text = request.files[category];
      if (text === undefined) continue;
      const parsed = parseBrowserImportFile(category, text);
      Object.assign(data, { [category]: parsed[category] });
    }
    if (data.cookies.length > 0) await applyImportedBrowserCookies(data.cookies);
    const imported = browserImportStore.import(data);
    const warnings = [
      "Imported data stays on this device. Passwords are filled only when you choose a matching saved login.",
    ];
    if (request.categories.includes("cookies"))
      warnings.push(
        "Cookies can grant access to signed-in accounts. Some websites bind sessions to the original browser and require signing in again."
      );
    if (request.categories.includes("history"))
      warnings.push(
        "Browsing history is available in Imported data; it does not recreate the current tab's Back/Forward stack."
      );
    return { imported, warnings };
  } finally {
    importing = false;
  }
}

export async function fillImportedLoginOnPage(
  page: Pick<AutomationPage, "url" | "evaluate">,
  login: ImportedLogin
): Promise<void> {
  let origin: string;
  try {
    const url = new URL(page.url());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error();
    origin = url.origin;
  } catch {
    throw new Error("Open the matching website before using this saved login.");
  }
  if (origin !== login.origin) throw new Error("This saved login belongs to a different website.");
  const credentials = JSON.stringify({
    origin: login.origin,
    username: login.username,
    password: login.password,
  });
  const filled = await page.evaluate<boolean>(`(() => {
    const credential = ${credentials};
    if (location.origin !== credential.origin) return false;
    const visible = (input) => !input.disabled && !input.readOnly && input.getClientRects().length > 0;
    const password = Array.from(document.querySelectorAll('input[type="password"]')).find(visible);
    if (!password) return false;
    const form = password.form;
    if (form && new URL(form.action || location.href, location.href).origin !== credential.origin) return false;
    const scope = form || document;
    const username = Array.from(scope.querySelectorAll('input[autocomplete="username"], input[type="email"], input[name="username"], input[name="email"], input[type="text"]')).find(visible);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return false;
    if (username) setter.call(username, credential.username);
    setter.call(password, credential.password);
    for (const input of [username, password]) {
      if (!input) continue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  })()`);
  if (!filled)
    throw new Error(
      "No safe, visible login form was found on the matching website. Nothing was filled."
    );
}

export async function fillImportedBrowserLogin(body: unknown): Promise<void> {
  if (
    !body ||
    typeof body !== "object" ||
    !("consent" in body) ||
    body.consent !== true ||
    !("tab_id" in body) ||
    typeof body.tab_id !== "string" ||
    !("id" in body) ||
    typeof body.id !== "string"
  ) {
    throw new Error("Choose a saved login and explicitly confirm filling it.");
  }
  const supervision = getBrowserSupervisionSettings({ redact: false });
  const status = getBrowserSupervisionStatus();
  if (supervision.remoteRoutingEnabled || status.owner !== "local")
    throw new Error("Saved logins can only be filled in a local Cybara-owned browser.");
  const page = getPageById(body.tab_id);
  const login = browserImportStore.login(body.id);
  if (!page || !login) throw new Error("Browser tab or saved login not found.");
  await fillImportedLoginOnPage(page, login);
}
