import { describe, expect, test } from "bun:test";
import { join } from "path";

const root = join(import.meta.dir, "../..");

describe("account connector UI", () => {
  test("exposes a lazy connector route and sidebar destination", async () => {
    const app = await Bun.file(join(root, "ui/src/App.tsx")).text();
    const sidebar = await Bun.file(join(root, "ui/src/components/layout/Sidebar.tsx")).text();
    expect(app).toContain('path="/connectors"');
    expect(app).toContain('import("@/pages/Connectors")');
    expect(sidebar).toContain('path: "/connectors"');
  });

  test("uses switches for optional write access and keeps OAuth secrets masked", async () => {
    const page = await Bun.file(join(root, "ui/src/pages/Connectors.tsx")).text();
    expect(page).toContain("<Switch");
    expect(page).toContain('type="password"');
    expect(page).toContain("approval-gated");
    expect(page).toContain("creating events");
    expect(page).toContain("Loading account connectors");
    expect(page).not.toContain('type="checkbox"');
  });

  test("keeps connector identities in parity across web, mobile, and native macOS", async () => {
    const web = await Bun.file(join(root, "ui/src/pages/Connectors.tsx")).text();
    const mobile = await Bun.file(
      join(root, "apps/mobile/src/screens/dashboardConnectorsPanel.tsx")
    ).text();
    const macos = await Bun.file(
      join(root, "apps/macos/Cybara/Sources/Cybara/NativePlatformScreens.swift")
    ).text();

    for (const id of ["google_workspace", "microsoft_365", "notion"]) {
      expect(web).toContain(id);
      expect(mobile).toContain(id);
      expect(macos).toContain(id);
    }
  });
});
