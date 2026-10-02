import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleWrite } from "../../src/core/tools/handlers/file";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cybara-write-verification-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("caller-visible file write verification", () => {
  test("verifies exact UTF-8 bytes, hash and JSON syntax without changing contents", async () => {
    const path = join(root, "answer.json");
    const content = '{ "label": "é🌻", "value": 7, "escaped": "\\\\ and \\\"" }\n';
    const result = await handleWrite(
      { path, content },
      { workspaceDir: root, confineToWorkspace: true }
    );
    expect(readFileSync(path, "utf8")).toBe(content);
    expect(result.verification).toEqual({
      contentMatches: true,
      bytes: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
      jsonValid: true,
    });
  });
  test("reports invalid JSON honestly and does not silently repair user content", async () => {
    const path = join(root, "invalid.json");
    const result = await handleWrite(
      { path, content: '{"missing":' },
      { workspaceDir: root, confineToWorkspace: true }
    );
    expect(result.verification.jsonValid).toBe(false);
    expect(result.verification.contentMatches).toBe(true);
    expect(readFileSync(path, "utf8")).toBe('{"missing":');
  });
  test("an ordinary text write makes no JSON or semantic correctness assertion", async () => {
    const result = await handleWrite(
      { path: join(root, "output.txt"), content: "text" },
      { workspaceDir: root, confineToWorkspace: true }
    );
    expect(result.verification.jsonValid).toBeUndefined();
    expect(Object.keys(result.verification).sort()).toEqual(["bytes", "contentMatches", "sha256"]);
  });
});
