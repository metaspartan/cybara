import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SIDEBAR_NAVIGATION_LAYOUT,
  moveSidebarNavigationItem,
  parseSidebarNavigationLayout,
} from "../../ui/src/lib/sidebarNavigation";

describe("sidebar navigation layout", () => {
  test("defaults to the compact desktop rail", () => {
    expect(parseSidebarNavigationLayout(null)).toEqual({
      primary: ["dashboard", "usage", "more"],
      more: [
        "ide",
        "voice",
        "lab",
        "terminal",
        "lsp",
        "sessions",
        "journey",
        "wallet",
        "artifacts",
        "metrics",
        "tasks",
      ],
    });
  });

  test("accepts complete unique persisted layouts", () => {
    const layout = {
      primary: ["more", "metrics", "dashboard"],
      more: [
        "ide",
        "usage",
        "voice",
        "lab",
        "terminal",
        "lsp",
        "sessions",
        "journey",
        "wallet",
        "artifacts",
        "tasks",
      ],
    };
    expect(parseSidebarNavigationLayout(JSON.stringify(layout))).toEqual(layout);
  });

  test("migrates the previous default without changing custom layouts", () => {
    const previousDefault = {
      primary: ["dashboard", "ide", "usage", "more"],
      more: [
        "voice",
        "lab",
        "terminal",
        "lsp",
        "sessions",
        "journey",
        "wallet",
        "artifacts",
        "metrics",
        "tasks",
      ],
    };
    expect(parseSidebarNavigationLayout(JSON.stringify(previousDefault))).toEqual(
      DEFAULT_SIDEBAR_NAVIGATION_LAYOUT
    );

    const customized = {
      primary: ["dashboard", "ide", "more", "usage"],
      more: previousDefault.more,
    };
    expect(parseSidebarNavigationLayout(JSON.stringify(customized))).toEqual(customized);
  });

  test("rejects malformed, duplicate, incomplete, and unknown layouts", () => {
    for (const value of [
      "not-json",
      '{"primary":["dashboard","more"],"more":["dashboard"]}',
      '{"primary":["dashboard"],"more":[]}',
      '{"primary":["dashboard","more"],"more":["unknown"]}',
      '{"primary":["dashboard"],"more":["more"]}',
    ]) {
      expect(parseSidebarNavigationLayout(value)).toEqual(DEFAULT_SIDEBAR_NAVIGATION_LAYOUT);
    }
  });

  test("moves destinations between the main sidebar and More", () => {
    const promoted = moveSidebarNavigationItem(
      DEFAULT_SIDEBAR_NAVIGATION_LAYOUT,
      "ide",
      "primary",
      "usage"
    );
    expect(promoted.primary).toEqual(["dashboard", "ide", "usage", "more"]);
    expect(promoted.more).not.toContain("ide");

    const demoted = moveSidebarNavigationItem(promoted, "usage", "more", "voice");
    expect(demoted.primary).toEqual(["dashboard", "ide", "more"]);
    expect(demoted.more[0]).toBe("usage");
    expect(moveSidebarNavigationItem(demoted, "more", "more")).toEqual(demoted);
  });
});
