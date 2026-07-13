import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "../..");

describe("account connector UI", () => {
  test("exposes a lazy connector route and sidebar destination", () => {
    const app = readFileSync(join(root, "ui/src/App.tsx"), "utf8");
    const sidebar = readFileSync(join(root, "ui/src/components/layout/Sidebar.tsx"), "utf8");
    expect(app).toContain('path="/connectors"');
    expect(app).toContain('import("@/pages/Connectors")');
    expect(sidebar).toContain('path: "/connectors"');
  });

  test("uses switches for optional write access and keeps OAuth secrets masked", () => {
    const page = readFileSync(join(root, "ui/src/pages/Connectors.tsx"), "utf8");
    expect(page).toContain("<Switch");
    expect(page).toContain('type="password"');
    expect(page).toContain("approval-gated");
    expect(page).toContain("creating events");
    expect(page).toContain("Loading account connectors");
    expect(page).not.toContain('type="checkbox"');
  });
});
