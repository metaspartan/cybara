import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  classifyTestFlightUploadFailure,
  nextRetryDelayMs,
  parsePositiveInt,
  uploadIpaToTestFlight,
  type RunUploadCommand,
} from "../../scripts/upload-ios-testflight";

describe("TestFlight upload helper", () => {
  test("classifies App Store Connect server failures as retryable", () => {
    expect(
      classifyTestFlightUploadFailure(
        "CHANGE UPLOAD STATE TO COMPLETE: received status code 500; internal server error."
      )
    ).toBe("transient");
    expect(
      classifyTestFlightUploadFailure(
        "An unexpected error occurred on the server side. status : 503"
      )
    ).toBe("transient");
    expect(classifyTestFlightUploadFailure("network connection was lost")).toBe("transient");
  });

  test("keeps App Store Connect validation and credential failures fatal", () => {
    expect(classifyTestFlightUploadFailure("ERROR ITMS-90035: Invalid Signature")).toBe("fatal");
    expect(classifyTestFlightUploadFailure("Authentication credentials are missing or invalid")).toBe(
      "fatal"
    );
  });

  test("parses retry settings with safe fallbacks", () => {
    expect(parsePositiveInt("5", 2)).toBe(5);
    expect(parsePositiveInt("0", 2)).toBe(2);
    expect(parsePositiveInt("nope", 2)).toBe(2);
    expect(nextRetryDelayMs(1, 1_000)).toBe(1_000);
    expect(nextRetryDelayMs(3, 1_000)).toBe(4_000);
    expect(nextRetryDelayMs(20, 20_000)).toBe(180_000);
  });

  test("retries transient upload failures and leaves the signed IPA path available", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "cybara-testflight-upload-"));
    const warnings: string[] = [];
    const commands: string[][] = [];
    const runCommand: RunUploadCommand = async (command) => {
      commands.push(command);
      return {
        exitCode: 1,
        stdout: "",
        stderr: "received status code 500; internal server error",
      };
    };

    try {
      const uploaded = await uploadIpaToTestFlight({
        ipaPath: "/tmp/Cybara.ipa",
        apiKeyBase64: Buffer.from("PRIVATE KEY").toString("base64"),
        apiKeyId: "ABCDE12345",
        apiIssuerId: "issuer-id",
        attempts: 2,
        retryBaseDelayMs: 1,
        homeDir,
        runCommand,
        sleep: async () => {},
        warn: (message) => warnings.push(message),
      });

      expect(uploaded).toBe(false);
      expect(commands).toHaveLength(2);
      expect(commands[0]).toContain("/tmp/Cybara.ipa");
      expect(warnings).toHaveLength(1);
      expect(
        existsSync(join(homeDir, ".appstoreconnect", "private_keys", "AuthKey_ABCDE12345.p8"))
      ).toBe(false);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("does not retry non-retryable upload failures", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "cybara-testflight-upload-"));
    let calls = 0;

    try {
      await expect(
        uploadIpaToTestFlight({
          ipaPath: "/tmp/Cybara.ipa",
          apiKeyBase64: Buffer.from("PRIVATE KEY").toString("base64"),
          apiKeyId: "ABCDE12345",
          apiIssuerId: "issuer-id",
          attempts: 3,
          retryBaseDelayMs: 1,
          homeDir,
          runCommand: async () => {
            calls += 1;
            return {
              exitCode: 1,
              stdout: "",
              stderr: "ERROR ITMS-90035: Invalid Signature",
            };
          },
          sleep: async () => {},
        })
      ).rejects.toThrow("non-retryable");
      expect(calls).toBe(1);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
