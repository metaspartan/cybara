import { describe, expect, test } from "bun:test";
import { verifyWebhookSignature } from "../../src/core/channels/adapters/webhook";
import { smsAdapter } from "../../src/core/channels/adapters/sms";
import { emailAdapter } from "../../src/core/channels/adapters/email";
import { channels } from "../../src/core/channels/types";

function sign(body: string, secret: string): string {
  const { createHmac } = require("crypto");
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("new channel adapters", () => {
  test("the 3 new channel types are registered in the catalog", () => {
    const types = Object.keys(channels);
    expect(types).toContain("webhook");
    expect(types).toContain("sms");
    expect(types).toContain("email");
    expect(types.length).toBeGreaterThanOrEqual(10);
  });

  test("webhook signature: valid HMAC accepted", () => {
    const body = '{"event":"push"}';
    const sig = sign(body, "topsecret");
    expect(verifyWebhookSignature(body, sig, "topsecret")).toBe(true);
    expect(verifyWebhookSignature(body, `sha256=${sig}`, "topsecret")).toBe(true);
  });

  test("webhook signature: bad signature rejected", () => {
    const body = '{"event":"push"}';
    expect(verifyWebhookSignature(body, "deadbeef", "topsecret")).toBe(false);
    expect(verifyWebhookSignature(body, undefined, "topsecret")).toBe(false);
  });

  test("webhook signature: unsigned allowed when no secret configured", () => {
    expect(verifyWebhookSignature("body", undefined, "")).toBe(true);
  });
});

describe("sms + email adapter wiring", () => {
  test("sms adapter lifecycle + formatResponse", async () => {
    await smsAdapter.start("ch1", { account_sid: "ACx", auth_token: "t", from_number: "+1" });
    expect(smsAdapter.isRunning("ch1")).toBe(true);
    expect(smsAdapter.formatResponse("hello")).toBe("hello");
    await smsAdapter.stop("ch1");
    expect(smsAdapter.isRunning("ch1")).toBe(false);
  });

  test("sms sendMessage fails gracefully without credentials", async () => {
    await smsAdapter.start("ch2", {});
    const ok = await smsAdapter.sendMessage("ch2", "+15551234567", "hi");
    expect(ok).toBe(false);
    await smsAdapter.stop("ch2");
  });

  test("email adapter lifecycle + formatResponse", async () => {
    await emailAdapter.start("ch1", { smtp_host: "smtp.x.com", username: "u", password: "p", from_address: "a@x.com" });
    expect(emailAdapter.isRunning("ch1")).toBe(true);
    const out = emailAdapter.formatResponse("hello", [{ id: "1", name: "calc", status: "completed" }]);
    expect(out).toContain("hello");
    await emailAdapter.stop("ch1");
  });

  test("email sendMessage fails gracefully without SMTP config", async () => {
    await emailAdapter.start("ch2", {});
    const ok = await emailAdapter.sendMessage("ch2", "to@x.com", "hi");
    expect(ok).toBe(false);
    await emailAdapter.stop("ch2");
  });
});
