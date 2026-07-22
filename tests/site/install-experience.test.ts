import { describe, expect, test } from "bun:test";
import { DOWNLOAD_EXPERIENCES, DOWNLOAD_GROUPS, INSTALL_TABS } from "../../site/src/content";

describe("site install experiences", () => {
  test("separates the graphical desktop app from terminal installs", () => {
    expect(DOWNLOAD_EXPERIENCES.desktop.title).toBe("Desktop GUI");
    expect(DOWNLOAD_EXPERIENCES.desktop.description).toContain("graphical app");
    expect(DOWNLOAD_EXPERIENCES.cli.title).toBe("CLI + TUI");
    expect(DOWNLOAD_EXPERIENCES.cli.description).toContain("terminal app");
  });

  test("every one-line command identifies the CLI and TUI experience", () => {
    expect(INSTALL_TABS.length).toBeGreaterThan(0);
    for (const tab of INSTALL_TABS) {
      expect(tab.hint).toContain("CLI + TUI");
    }
  });

  test("desktop recommendations contain graphical installers only", () => {
    const desktop = DOWNLOAD_GROUPS.find((group) => group.label === "Desktop");
    expect(desktop).toBeDefined();
    expect(desktop?.clients.length).toBeGreaterThan(0);
    for (const client of desktop?.clients ?? []) {
      expect(client.command).toBeUndefined();
      expect(client.name).not.toContain("CLI");
    }
  });
});
