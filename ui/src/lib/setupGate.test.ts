import { describe, expect, test } from "bun:test";
import { resolveSetupGate, type SetupGateInput } from "./setupGate";

const base: SetupGateInput = {
  pathname: "/",
  setupComplete: false,
  setupReady: false,
  cachedSetupComplete: false,
};

describe("resolveSetupGate", () => {
  test("the /setup route always renders its children", () => {
    expect(resolveSetupGate({ ...base, pathname: "/setup" })).toBe("children");
    expect(resolveSetupGate({ ...base, pathname: "/setup", setupReady: true })).toBe("children");
  });

  test("cold first load before setup status shows the spinner, never a redirect", () => {
    expect(resolveSetupGate(base)).toBe("spinner");
  });

  test("returning user cache skips the spinner while setup status refreshes", () => {
    expect(resolveSetupGate({ ...base, cachedSetupComplete: true })).toBe("children");
    expect(resolveSetupGate({ ...base, cachedSetupComplete: true, setupReady: false })).toBe(
      "children"
    );
  });

  test("never redirects to /setup until setup status has actually resolved", () => {
    expect(resolveSetupGate({ ...base, setupReady: false })).not.toBe("redirect");
  });

  test("resolved complete setup renders the app", () => {
    expect(
      resolveSetupGate({
        ...base,
        setupReady: true,
        setupComplete: true,
      })
    ).toBe("children");
  });

  test("resolved incomplete setup redirects to setup", () => {
    expect(resolveSetupGate({ ...base, setupReady: true, setupComplete: false })).toBe("redirect");
  });

  test("a stale setupComplete cache still redirects once status confirms incomplete", () => {
    expect(
      resolveSetupGate({
        ...base,
        cachedSetupComplete: true,
        setupReady: true,
        setupComplete: false,
      })
    ).toBe("redirect");
  });
});
