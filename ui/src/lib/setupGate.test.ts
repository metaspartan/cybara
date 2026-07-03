import { describe, expect, test } from "bun:test";
import { resolveSetupGate, type SetupGateInput } from "./setupGate";

const base: SetupGateInput = {
  pathname: "/",
  providersReady: false,
  agentsReady: false,
  providerCount: 0,
  agentCount: 0,
  setupComplete: false,
};

describe("resolveSetupGate", () => {
  test("the /setup route always renders its children", () => {
    expect(resolveSetupGate({ ...base, pathname: "/setup" })).toBe("children");
    expect(
      resolveSetupGate({ ...base, pathname: "/setup", providersReady: true, agentsReady: true })
    ).toBe("children");
  });

  test("cold first load with no data shows the spinner, never a redirect", () => {
    expect(resolveSetupGate(base)).toBe("spinner");
    expect(resolveSetupGate({ ...base, providersReady: true, agentsReady: false })).toBe("spinner");
    expect(resolveSetupGate({ ...base, providersReady: false, agentsReady: true })).toBe("spinner");
  });

  test("returning user (setupComplete) skips the spinner and renders immediately", () => {
    expect(resolveSetupGate({ ...base, setupComplete: true })).toBe("children");
    expect(
      resolveSetupGate({ ...base, setupComplete: true, providersReady: true, agentsReady: false })
    ).toBe("children");
  });

  test("never redirects to /setup until both queries have actually resolved", () => {
    for (const providersReady of [false, true]) {
      for (const agentsReady of [false, true]) {
        if (providersReady && agentsReady) continue;
        expect(resolveSetupGate({ ...base, providersReady, agentsReady })).not.toBe("redirect");
      }
    }
  });

  test("resolved + populated renders the app", () => {
    expect(
      resolveSetupGate({
        ...base,
        providersReady: true,
        agentsReady: true,
        providerCount: 3,
        agentCount: 2,
      })
    ).toBe("children");
  });

  test("resolved + genuinely empty redirects to setup", () => {
    expect(resolveSetupGate({ ...base, providersReady: true, agentsReady: true })).toBe("redirect");
    expect(
      resolveSetupGate({
        ...base,
        providersReady: true,
        agentsReady: true,
        providerCount: 5,
        agentCount: 0,
      })
    ).toBe("redirect");
  });

  test("a populated but stale setupComplete flag still redirects once data confirms empty", () => {
    expect(
      resolveSetupGate({
        ...base,
        setupComplete: true,
        providersReady: true,
        agentsReady: true,
        providerCount: 0,
        agentCount: 0,
      })
    ).toBe("redirect");
  });
});
