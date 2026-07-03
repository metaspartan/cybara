import { describe, expect, test } from "bun:test";
import { assertRecipientAllowed, assertAmountWithinCap } from "../../src/core/wallet-policy";

// Pure unit tests for the agent fund-movement guards. These live in a dedicated
// module so they are unit-testable in isolation and immune to the global
// `mock.module` the wallet-tool-handler test installs.

const ALLOW = "0x1111111111111111111111111111111111111111";
const OTHER = "0x9999999999999999999999999999999999999999";

describe("wallet-policy: recipient allowlist", () => {
  test("blocks a non-allowlisted recipient when an allowlist is set", () => {
    expect(() =>
      assertRecipientAllowed(OTHER, { allowedSendRecipients: [ALLOW], maxSendAmount: "" })
    ).toThrow(/allowlist/i);
  });

  test("permits an allowlisted recipient (case-insensitive)", () => {
    expect(() =>
      assertRecipientAllowed(ALLOW.toUpperCase(), {
        allowedSendRecipients: [ALLOW],
        maxSendAmount: "",
      })
    ).not.toThrow();
  });

  test("no explicit recipient (self) is allowed even with an allowlist", () => {
    expect(() =>
      assertRecipientAllowed(undefined, { allowedSendRecipients: [ALLOW], maxSendAmount: "" })
    ).not.toThrow();
  });

  test("empty allowlist means no recipient restriction", () => {
    expect(() =>
      assertRecipientAllowed(OTHER, { allowedSendRecipients: [], maxSendAmount: "" })
    ).not.toThrow();
  });
});

describe("wallet-policy: per-transaction cap", () => {
  test("blocks an amount over the cap", () => {
    expect(() =>
      assertAmountWithinCap("5", { allowedSendRecipients: [], maxSendAmount: "0.5" })
    ).toThrow(/cap/i);
  });

  test("allows an amount at/under the cap", () => {
    expect(() =>
      assertAmountWithinCap("0.4", { allowedSendRecipients: [], maxSendAmount: "0.5" })
    ).not.toThrow();
  });

  test("no cap configured allows any amount", () => {
    expect(() =>
      assertAmountWithinCap("1000", { allowedSendRecipients: [], maxSendAmount: "" })
    ).not.toThrow();
  });

  test("non-numeric amount is rejected when a cap is set", () => {
    expect(() =>
      assertAmountWithinCap("not-a-number", { allowedSendRecipients: [], maxSendAmount: "1" })
    ).toThrow(/cap/i);
  });
});
