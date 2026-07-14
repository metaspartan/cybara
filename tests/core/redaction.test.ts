import { describe, expect, test } from "bun:test";
import { redactSecretText, redactSecrets } from "../../src/core/redaction";

const LEAKY_SAMPLES: Array<[string, string]> = [
  ["cybara key", "auth failed for cybara_0123456789abcdef0123456789abcdef"],
  ["openai style", "using sk-abcdefghijklmnop1234 for the call"],
  ["stripe live", "billing with sk_live_4eC39HqLyjWDarjtT1zdp7dc"],
  ["stripe restricted", "billing with rk_live_4eC39HqLyjWDarjtT1zdp7dc"],
  ["github classic", "push failed with ghp_abcdefghijklmnopqrst123456"],
  ["github fine-grained", "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz1234567890"],
  ["gitlab", "glpat-abcdefghij1234567890"],
  ["slack bot", "xoxb-1234567890-abcdefghijklmnop"],
  ["slack app", "xapp-1-A052N9J1L4A-5177886119042-abc123def456ghi789"],
  [
    "slack webhook",
    "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX",
  ],
  [
    "discord webhook",
    "https://discord.com/api/webhooks/1234567890/AbCdEfGh_iJkLmNoPqRsTuVwXyZ-0123456789",
  ],
  ["google", "AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY"],
  ["aws access key", "AKIAIOSFODNN7EXAMPLE"],
  ["aws temporary key", "ASIAIOSFODNN7EXAMPLE"],
  ["npm", "npm_abcdefghijklmnopqrstuvwxyz0123456789"],
  ["telegram bot", "5512345678:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"],
  [
    "jwt",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c",
  ],
  ["pem", "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----"],
  ["bearer header", "Authorization: Bearer abc.def.ghi"],
  ["key-value", "api_key=super-secret-value fetch failed"],
];

const SAFE_SAMPLES: Array<[string, string]> = [
  ["prose", "the quick brown fox jumps over the lazy dog"],
  ["path", "/Users/dev/projects/cybara/src/core/redaction.ts"],
  ["url", "https://docs.example.com/guides/getting-started?step=2"],
  ["timestamp", "2026-07-14T12:34:56.789Z request took 1234ms"],
  ["uuid", "session 550e8400-e29b-41d4-a716-446655440000 resumed"],
  ["short ratio", "completed 12345678:90 of work"],
];

describe("secret text redaction", () => {
  for (const [label, text] of LEAKY_SAMPLES) {
    test(`redacts ${label}`, () => {
      expect(redactSecretText(text)).toContain("[REDACTED]");
    });
  }

  for (const [label, text] of SAFE_SAMPLES) {
    test(`leaves ${label} untouched`, () => {
      expect(redactSecretText(text)).toBe(text);
    });
  }
});

describe("structured value redaction", () => {
  test("redacts sensitively named keys and nested string values", () => {
    const output = redactSecrets({
      api_key: "raw-value",
      nested: { note: "token ghp_abcdefghijklmnopqrst123456 leaked" },
      count: 3,
    }) as Record<string, unknown>;

    expect(output.api_key).toBe("[REDACTED]");
    expect(JSON.stringify(output.nested)).toContain("[REDACTED]");
    expect(JSON.stringify(output.nested)).not.toContain("ghp_");
    expect(output.count).toBe(3);
  });
});
