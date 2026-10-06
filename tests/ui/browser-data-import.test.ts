import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const component = readFileSync(
  join(import.meta.dir, "../../ui/src/pages/chat/BrowserDataImport.tsx"),
  "utf8"
);
const browser = readFileSync(
  join(import.meta.dir, "../../ui/src/pages/chat/ChatWorkspaceBrowser.tsx"),
  "utf8"
);
const styles = readFileSync(
  join(import.meta.dir, "../../ui/src/pages/chat/browserDataImport.css"),
  "utf8"
);

describe("embedded browser import UI contracts", () => {
  test("banner is mounted exactly once above browser navigation, including error states", () => {
    expect(browser.match(/<BrowserDataImport/g)).toHaveLength(1);
    expect(browser.indexOf("<BrowserDataImport")).toBeLessThan(
      browser.indexOf('aria-label="Go back"')
    );
    expect(component).toContain("Make this browser yours");
    expect(component).toContain("Import browser data");
    expect(component).toContain("Imported data");
  });

  test("auto import needs no category selection and only explicit consent", () => {
    expect(component).toContain('"/api/browser/import/auto"');
    expect(component).toContain("consent: true");
    expect(component).toContain("useState(false)");
    expect(component).toContain("setConsent(false)");
    expect(component).toContain("operation.current");
    expect(component).toContain("!consent ||");
    expect(component).not.toContain("available.sources?.[0]?.id");
    expect(component).not.toContain("sourceId");
  });

  test("detected categories are shown read-only and unavailable data is explained", () => {
    expect(component).toContain("Detected");
    expect(component).toContain("Unavailable");
    expect(component).toContain("Will be imported automatically");
    expect(component).toContain("unavailableReason");
    expect(component).toContain("Found on this device");
  });

  test("file import remains available as an explicit opt-in fallback", () => {
    expect(component).toContain("FileImportPanel");
    expect(component).toContain("file.size > 8 * 1024 * 1024");
    expect(component).toContain("setFiles({})");
    expect(component).toContain("Import from an exported file instead");
  });

  test("keeps passwords out of the library and fills only a matching-site login", () => {
    expect(component).toContain("login.origin === webOrigin(url)");
    expect(component).toContain('"/api/browser/import/fill"');
    expect(component).toContain("Saved passwords");
    expect(component).toContain("Cookies & sign-ins");
    expect(component).toContain("Password");
    expect(component).not.toContain("login.password");
  });

  test("dismisses the whole banner and keeps permanent Settings access without a bottom popup", () => {
    expect(component).toContain("localStorage.setItem(DISMISS_KEY");
    expect(component).toContain("onClick={() => void show()}");
    expect(component).toContain("<Modal isOpen={open}");
    expect(component).toContain('role="alert"');
    expect(component).toContain('entry === "settings"');
    expect(component).toContain("!bannerHidden ? (");
    const settings = readFileSync(join(import.meta.dir, "../../ui/src/pages/Settings.tsx"), "utf8");
    expect(settings).toContain('<BrowserDataImport entry="settings" />');
    const chat = readFileSync(join(import.meta.dir, "../../ui/src/pages/Chat.tsx"), "utf8");
    expect(chat).not.toContain("<FloatingBrowserPreview");
    expect(styles).toMatch(/@media\s*\(max-width:\s*640px\)/);
    expect(styles).toContain(":focus-visible");
  });
});
