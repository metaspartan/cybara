import { describe, expect, test } from "bun:test";
import { createHmac, createHash } from "crypto";
import { verifyLineSignature } from "../../src/core/channels/line-events";
import { verifyMsTeamsSignature } from "../../src/core/channels/msteams-events";
import { verifyDingTalkSignature, signDingTalk } from "../../src/core/channels/dingtalk-events";
import { verifyWecomSignature, wecomSignature } from "../../src/core/channels/wecom-crypto";
import {
  verifyNextcloudSignature,
  signNextcloud,
} from "../../src/core/channels/nextcloud-events";
import { verifyZaloMac } from "../../src/core/channels/zalo-events";
import { verifyFeishuSignature } from "../../src/core/channels/feishu-events";
import { verifyWebhookSignature } from "../../src/core/channels/adapters/webhook";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x5163a11);
function randInt(max: number): number {
  return Math.floor(rand() * max);
}

const POOL =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_{}[]:\"',.日本語😀\t\n";
function randStr(maxLen: number): string {
  const len = randInt(maxLen) + 1;
  let out = "";
  for (let i = 0; i < len; i++) out += POOL[randInt(POOL.length)];
  return out;
}

interface Adapter {
  name: string;
  sign: (payload: string, secret: string) => string;
  verify: (payload: string, sig: string, secret: string) => boolean;
}

const ADAPTERS: Adapter[] = [
  {
    name: "line",
    sign: (p, s) => createHmac("sha256", s).update(p).digest("base64"),
    verify: (p, sig, s) => verifyLineSignature(p, sig, s),
  },
  {
    name: "msteams",
    sign: (p, s) =>
      createHmac("sha256", Buffer.from(s, "base64")).update(p, "utf8").digest("base64"),
    verify: (p, sig, s) => verifyMsTeamsSignature(p, `HMAC ${sig}`, s),
  },
  {
    name: "nextcloud",
    sign: (p, s) => signNextcloud("randomconst", p, s),
    verify: (p, sig, s) => verifyNextcloudSignature("randomconst", p, sig, s),
  },
  {
    name: "webhook-hex",
    sign: (p, s) => createHmac("sha256", s).update(p).digest("hex"),
    verify: (p, sig, s) => verifyWebhookSignature(p, sig, s),
  },
  {
    name: "webhook-prefixed",
    sign: (p, s) => "sha256=" + createHmac("sha256", s).update(p).digest("hex"),
    verify: (p, sig, s) => verifyWebhookSignature(p, sig, s),
  },
];

describe("per-adapter HMAC/signature verification (body-keyed)", () => {
  for (const adapter of ADAPTERS) {
    describe(adapter.name, () => {
      test("accepts a correctly-computed signature", () => {
        const secret = "s3cr3t-" + randStr(12);
        const payload = randStr(64);
        expect(adapter.verify(payload, adapter.sign(payload, secret), secret)).toBe(true);
      });

      test("rejects empty / missing signature", () => {
        const secret = "s3cr3t";
        const payload = randStr(32);
        expect(adapter.verify(payload, "", secret)).toBe(false);
        expect(adapter.verify(payload, undefined as unknown as string, secret)).toBe(false);
      });

      test("rejects a wrong-length signature without throwing", () => {
        const secret = "s3cr3t";
        const payload = randStr(32);
        const good = adapter.sign(payload, secret);
        for (const bad of ["a", good + "extra", good.slice(0, -1), "x".repeat(200)]) {
          let result: boolean | null = null;
          expect(() => {
            result = adapter.verify(payload, bad, secret);
          }).not.toThrow();
          expect(result).toBe(false);
        }
      });

      test("rejects a signature computed with the wrong secret", () => {
        const payload = randStr(48);
        const sig = adapter.sign(payload, "correct-secret");
        expect(adapter.verify(payload, sig, "wrong-secret")).toBe(false);
      });

      test("fuzz: valid sigs accept, single-byte flips reject (150 cases)", () => {
        for (let i = 0; i < 150; i++) {
          const secret = randStr(24);
          const payload = randStr(96);
          const good = adapter.sign(payload, secret);
          expect(adapter.verify(payload, good, secret)).toBe(true);

          const pos = randInt(good.length);
          const orig = good[pos];
          let repl = orig;
          while (repl === orig) {
            repl = "0123456789abcdefABCDEF+/=gHkZ".charAt(randInt(29));
          }
          const flipped = good.slice(0, pos) + repl + good.slice(pos + 1);
          if (flipped === good) continue;
          expect(adapter.verify(payload, flipped, secret)).toBe(false);

          const otherSecret = "different-" + secret + "-key";
          const otherSig = adapter.sign(payload, otherSecret);
          if (otherSig !== good) {
            expect(adapter.verify(payload, otherSig, secret)).toBe(false);
          }
          expect(adapter.verify(payload + "x", good, secret)).toBe(false);
        }
      });

      test("fuzz: every single-byte flip of one signature is rejected", () => {
        const secret = "fixed-secret-abc";
        const payload = "the-quick-brown-fox-payload";
        const good = adapter.sign(payload, secret);
        for (let pos = 0; pos < good.length; pos++) {
          const orig = good[pos];
          const repl = orig === "a" ? "b" : "a";
          const flipped = good.slice(0, pos) + repl + good.slice(pos + 1);
          if (flipped === good) continue;
          expect(adapter.verify(payload, flipped, secret)).toBe(false);
        }
      });
    });
  }
});

describe("dingtalk timestamp-keyed signature", () => {
  const verify = (ts: string, sig: string, secret: string) =>
    verifyDingTalkSignature(ts, sig, secret);

  test("accepts correct, rejects tampered/empty/wrong-length/wrong-secret", () => {
    const secret = "dt-secret";
    const ts = "1700000000000";
    const good = signDingTalk(ts, secret);
    expect(verify(ts, good, secret)).toBe(true);
    expect(verify(ts, "", secret)).toBe(false);
    expect(verify("", good, secret)).toBe(false);
    expect(verify(ts, good, "")).toBe(false);
    expect(verify(ts, good, "other")).toBe(false);
    expect(() => verify(ts, "short", secret)).not.toThrow();
    expect(verify(ts, "short", secret)).toBe(false);
  });

  test("fuzz: 150 seeded cases", () => {
    for (let i = 0; i < 150; i++) {
      const secret = randStr(24);
      const ts = String(randInt(2_000_000_000_000));
      const good = signDingTalk(ts, secret);
      expect(verify(ts, good, secret)).toBe(true);
      expect(verify(ts + "0", good, secret)).toBe(false);
      const pos = randInt(good.length);
      const flipped = good.slice(0, pos) + (good[pos] === "A" ? "B" : "A") + good.slice(pos + 1);
      if (flipped !== good) expect(verify(ts, flipped, secret)).toBe(false);
    }
  });
});

describe("wecom sorted-SHA1 signature", () => {
  const verify = (token: string, ts: string, nonce: string, enc: string, sig: string) =>
    verifyWecomSignature(token, ts, nonce, enc, sig);

  test("accepts correct, rejects tampered/empty/wrong-length/wrong-token", () => {
    const token = "wc-token";
    const ts = "1700000000";
    const nonce = "nonce-x";
    const enc = "ENCPAYLOAD";
    const good = wecomSignature(token, ts, nonce, enc);
    expect(verify(token, ts, nonce, enc, good)).toBe(true);
    expect(verify(token, ts, nonce, "TAMPERED", good)).toBe(false);
    expect(verify(token, ts, nonce, enc, "")).toBe(false);
    expect(verify("", ts, nonce, enc, good)).toBe(false);
    expect(verify("other", ts, nonce, enc, good)).toBe(false);
    expect(() => verify(token, ts, nonce, enc, "abc")).not.toThrow();
    expect(verify(token, ts, nonce, enc, "abc")).toBe(false);
  });

  test("fuzz: 150 seeded cases", () => {
    for (let i = 0; i < 150; i++) {
      const token = randStr(16);
      const ts = String(randInt(2_000_000_000));
      const nonce = randStr(12);
      const enc = randStr(40);
      const good = wecomSignature(token, ts, nonce, enc);
      expect(verify(token, ts, nonce, enc, good)).toBe(true);
      const pos = randInt(good.length);
      const repl = good[pos] === "a" ? "b" : "a";
      const flipped = good.slice(0, pos) + repl + good.slice(pos + 1);
      if (flipped !== good) expect(verify(token, ts, nonce, enc, flipped)).toBe(false);
      expect(verify(token, ts, nonce, enc + "z", good)).toBe(false);
    }
  });
});

describe("zalo appId+body+timestamp+secret MAC", () => {
  const sign = (appId: string, raw: string, ts: string, secret: string) =>
    createHash("sha256").update(appId + raw + ts + secret).digest("hex");

  test("accepts correct, rejects tampered/empty/wrong-length/wrong-secret", () => {
    const appId = "app-1";
    const raw = '{"event_name":"user_send_text"}';
    const ts = "1700000000000";
    const secret = "zalo-secret";
    const good = sign(appId, raw, ts, secret);
    expect(verifyZaloMac(appId, raw, ts, secret, good)).toBe(true);
    expect(verifyZaloMac(appId, raw, ts, secret, "")).toBe(false);
    expect(verifyZaloMac(appId, raw, ts, "wrong", good)).toBe(false);
    expect(verifyZaloMac(appId, raw + "x", ts, secret, good)).toBe(false);
    expect(() => verifyZaloMac(appId, raw, ts, secret, "short")).not.toThrow();
    expect(verifyZaloMac(appId, raw, ts, secret, "short")).toBe(false);
  });

  test("fuzz: 150 seeded cases", () => {
    for (let i = 0; i < 150; i++) {
      const appId = randStr(8);
      const raw = randStr(80);
      const ts = String(randInt(2_000_000_000_000));
      const secret = randStr(20);
      const good = sign(appId, raw, ts, secret);
      expect(verifyZaloMac(appId, raw, ts, secret, good)).toBe(true);
      const pos = randInt(good.length);
      const flipped = good.slice(0, pos) + (good[pos] === "0" ? "1" : "0") + good.slice(pos + 1);
      if (flipped !== good) expect(verifyZaloMac(appId, raw, ts, secret, flipped)).toBe(false);
      expect(verifyZaloMac(appId, raw, ts + "0", secret, good)).toBe(false);
    }
  });
});

describe("feishu timestamp+nonce+key+body signature", () => {
  const sign = (ts: string, nonce: string, key: string, raw: string) =>
    createHash("sha256").update(ts + nonce + key + raw, "utf8").digest("hex");

  test("accepts correct, rejects tampered/empty/wrong-length/wrong-key", () => {
    const ts = "1700000000";
    const nonce = "nonce-1";
    const key = "encrypt-key";
    const raw = '{"schema":"2.0"}';
    const good = sign(ts, nonce, key, raw);
    expect(verifyFeishuSignature(ts, nonce, key, raw, good)).toBe(true);
    expect(verifyFeishuSignature(ts, nonce, key, raw, "")).toBe(false);
    expect(verifyFeishuSignature(ts, nonce, "", raw, good)).toBe(false);
    expect(verifyFeishuSignature(ts, nonce, "wrong", raw, good)).toBe(false);
    expect(verifyFeishuSignature(ts, nonce, key, raw + "x", good)).toBe(false);
    expect(() => verifyFeishuSignature(ts, nonce, key, raw, "abc")).not.toThrow();
    expect(verifyFeishuSignature(ts, nonce, key, raw, "abc")).toBe(false);
  });

  test("fuzz: 150 seeded cases", () => {
    for (let i = 0; i < 150; i++) {
      const ts = String(randInt(2_000_000_000));
      const nonce = randStr(10);
      const key = randStr(20);
      const raw = randStr(80);
      const good = sign(ts, nonce, key, raw);
      expect(verifyFeishuSignature(ts, nonce, key, raw, good)).toBe(true);
      const pos = randInt(good.length);
      const flipped = good.slice(0, pos) + (good[pos] === "0" ? "1" : "0") + good.slice(pos + 1);
      if (flipped !== good) expect(verifyFeishuSignature(ts, nonce, key, raw, flipped)).toBe(false);
      expect(verifyFeishuSignature(ts, nonce, key + "z", raw, good)).toBe(false);
    }
  });
});

describe("webhook verifier: unsigned-when-no-secret contract", () => {
  test("empty secret accepts anything (documented open-mode)", () => {
    expect(verifyWebhookSignature("body", undefined, "")).toBe(true);
    expect(verifyWebhookSignature("body", "garbage", "")).toBe(true);
  });

  test("with a secret, missing signature is rejected", () => {
    expect(verifyWebhookSignature("body", undefined, "secret")).toBe(false);
  });
});
