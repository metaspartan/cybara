import type {
  BrowserImportCategory,
  BrowserImportData,
  BrowserImportProfile,
  ImportedLogin,
} from "../../../shared/browser-import";
import type { AutomationPage } from "./automation-driver";
import { parseBrowserImportFile } from "./import-parsers";
import {
  detectBrowserImportProfiles,
  readAllBrowserImportProfiles,
  readBrowserImportProfile,
} from "./chromium-profiles";
import { browserImportStore, type BrowserImportCounts } from "./import-store";
import { applyImportedBrowserCookies, getPageById } from "./pw-manager";
import { getBrowserSupervisionSettings, getBrowserSupervisionStatus } from "./supervision";

const CATEGORIES: BrowserImportCategory[] = ["passwords", "cookies", "history", "bookmarks"];
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
let importing = false;

export interface BrowserAutoImportResult {
  imported: BrowserImportCounts;
  profiles: number;
  lockedCategories: BrowserImportCategory[];
  warnings: string[];
}

interface BrowserImportRequest {
  categories: BrowserImportCategory[];
  source_id?: string;
  files: Partial<Record<BrowserImportCategory, string>>;
}

function requiresConsent(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && "consent" in body && body.consent === true);
}

export function validateBrowserImportRequest(body: unknown): BrowserImportRequest {
  if (!requiresConsent(body)) {
    throw new Error("Confirm that you want to import the selected browser data.");
  }
  const target = body as Record<string, unknown>;
  const requested = target.categories;
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > CATEGORIES.length) {
    throw new Error("Choose at least one browser data category.");
  }
  const categories: BrowserImportCategory[] = [];
  for (const category of requested) {
    if (typeof category !== "string" || !CATEGORIES.includes(category as BrowserImportCategory))
      throw new Error("Unsupported browser data category.");
    if (categories.includes(category as BrowserImportCategory))
      throw new Error("Duplicate browser data category.");
    categories.push(category as BrowserImportCategory);
  }
  const source = target.source_id;
  if (source !== undefined && (typeof source !== "string" || !/^[a-f0-9]{32,64}$/.test(source)))
    throw new Error("Invalid browser source.");
  const rawFiles = target.files ?? {};
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
    if (files[category] === undefined && !source) {
      throw new Error(
        `Choose an exported ${category} file, or import automatically to read it from your browser.`
      );
    }
  }
  return { categories, source_id: typeof source === "string" ? source : undefined, files };
}

export function listBrowserImportProfiles(): BrowserImportProfile[] {
  return detectBrowserImportProfiles();
}

export function autoImportWarnings(
  categories: BrowserImportCategory[],
  locked: BrowserImportCategory[],
  notes: string[]
): string[] {
  const warnings = [
    "Imported data stays on this device. Passwords are filled only when you choose a matching saved login.",
  ];
  if (categories.includes("cookies"))
    warnings.push(
      "Cookies can grant access to signed-in accounts. Some websites bind sessions to the original browser and require signing in again."
    );
  if (categories.includes("history"))
    warnings.push(
      "Browsing history is available in Imported data; it does not recreate the current tab's Back/Forward stack."
    );
  const lockedLabels = locked.map((category) => CATEGORY_NOUNS[category]).join(", ");
  if (locked.length > 0)
    warnings.push(
      `Skipped ${lockedLabels} because the browser is using those files. Close it and import again to include them.`
    );
  warnings.push(...notes);
  return warnings;
}

const CATEGORY_NOUNS: Record<BrowserImportCategory, string> = {
  passwords: "saved passwords",
  cookies: "cookies",
  history: "browsing history",
  bookmarks: "bookmarks",
};

async function withImportLock<T>(action: () => Promise<T>): Promise<T> {
  if (importing) throw new Error("Another browser import is running. Wait for it to finish.");
  importing = true;
  try {
    return await action();
  } finally {
    importing = false;
  }
}

async function persist(data: BrowserImportData): Promise<BrowserImportCounts> {
  if (data.cookies.length > 0) await applyImportedBrowserCookies(data.cookies);
  return browserImportStore.import(data);
}

export async function importAllBrowserData(body: unknown): Promise<BrowserAutoImportResult> {
  if (!requiresConsent(body)) {
    throw new Error("Confirm that you want to import your browser data into Cybara.");
  }
  return withImportLock(async () => {
    const discovered = readAllBrowserImportProfiles();
    if (discovered.profiles === 0)
      throw new Error(
        "No supported browser was found on this device. Install or open Chrome, Edge, Brave or Chromium first."
      );
    const categories = CATEGORIES.filter((category) => discovered.data[category].length > 0);
    if (categories.length === 0)
      throw new Error(
        "Your browser data could not be read yet. Close your browser and import again."
      );
    const imported = await persist(discovered.data);
    return {
      imported,
      profiles: discovered.profiles,
      lockedCategories: discovered.locked,
      warnings: autoImportWarnings(categories, discovered.locked, discovered.notes),
    };
  });
}

export async function importBrowserData(body: unknown): Promise<BrowserAutoImportResult> {
  const request = validateBrowserImportRequest(body);
  return withImportLock(async () => {
    const data: BrowserImportData = { passwords: [], cookies: [], history: [], bookmarks: [] };
    let locked: BrowserImportCategory[] = [];
    const notes: string[] = [];
    let profiles = 0;
    if (request.source_id) {
      const result = readBrowserImportProfile(request.source_id);
      profiles = 1;
      locked = result.locked;
      notes.push(...result.notes);
      for (const category of CATEGORIES) {
        if (request.files[category] !== undefined) continue;
        if (!request.categories.includes(category)) continue;
        if (category === "passwords") data.passwords = result.data.passwords;
        else if (category === "cookies") data.cookies = result.data.cookies;
        else if (category === "history") data.history = result.data.history;
        else data.bookmarks = result.data.bookmarks;
      }
    }
    for (const category of request.categories) {
      const text = request.files[category];
      if (text === undefined) continue;
    }
    const imported = await persist(data);
    return {
      imported,
      profiles,
      lockedCategories: locked,
      warnings: autoImportWarnings(request.categories, locked, notes),
    };
  });
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
    !requiresConsent(body) ||
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
