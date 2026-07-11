import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const componentSource = readFileSync(
  join(root, "ui/src/components/settings/SystemBackupSettingsSection.tsx"),
  "utf8"
);
const settingsSource = readFileSync(join(root, "ui/src/pages/Settings.tsx"), "utf8");
const apiSource = readFileSync(join(root, "ui/src/lib/api.ts"), "utf8");
const routesSource = readFileSync(join(root, "src/api/routes.ts"), "utf8");

describe("system backup settings", () => {
  test("places backup and restore controls in the System settings surface", () => {
    expect(settingsSource).toContain("<SystemBackupSettingsSection />");
    expect(componentSource).toContain("Backup & Restore");
    expect(componentSource).toContain("Create Backup");
    expect(componentSource).toContain("Restore & Restart");
    expect(componentSource).toContain("Backups contain provider credentials");
  });

  test("uses the shared root-protected backup API contract", () => {
    expect(apiSource).toContain('fetchApi<SystemBackupsResponse>("/system/backups")');
    expect(apiSource).toContain("restoreBackup");
    expect(routesSource).toContain('"GET /api/system/backups"');
    expect(routesSource).toContain('"POST /api/system/backups/:id/restore"');
  });
});
