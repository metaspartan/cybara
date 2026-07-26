import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { handleMemoryDelete, handleMemoryEdit } from "../../src/api/memory/memory-api";
import { memoryDir } from "../../src/core/paths";

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

const rand = mulberry32(0xfeedface);

function randInt(max: number): number {
  return Math.floor(rand() * max);
}

const POOL = "abz09./\\%~-_ \0\n$'\"‥․﹒＼／😀";

function randomTraversalPayload(): string {
  const segments = ["..", "../..", "etc", "passwd", "%2e%2e", "..%2f", "~", "", "\0"];
  let out = "";
  const parts = 1 + randInt(6);
  for (let i = 0; i < parts; i++) {
    out +=
      rand() > 0.5
        ? segments[randInt(segments.length)]
        : POOL[randInt(POOL.length)].repeat(1 + randInt(4));
    if (i < parts - 1) out += rand() > 0.5 ? "/" : "\\";
  }
  return out;
}

let sentinelDir = "";
let sentinelFile = "";
let memoryListingBefore: string[] = [];

function candidatePath(payload: string): string | null {
  const safe = basename(payload.trim()).replace(/[^\w.-]/g, "-");
  if (!safe || safe === "." || safe === "..") return null;
  return join(memoryDir, safe);
}

function listMemoryDir(): string[] {
  return existsSync(memoryDir) ? readdirSync(memoryDir).sort() : [];
}

beforeAll(() => {
  sentinelDir = mkdtempSync(join(tmpdir(), "cybara-memory-fuzz-"));
  sentinelFile = join(sentinelDir, "sentinel.md");
  writeFileSync(sentinelFile, "## 01:02:03 - note [fuzz]\n\ndo not touch\n", "utf-8");
  memoryListingBefore = listMemoryDir();
});

afterAll(() => {
  if (sentinelDir) rmSync(sentinelDir, { recursive: true, force: true });
});

const FIXED_PAYLOADS = [
  "..",
  "../",
  "../..",
  "../../etc/passwd",
  "..%2f..%2fetc%2fpasswd",
  "a/../../b",
  "/etc/passwd",
  "\\\\server\\share\\x.md",
  "C:\\Windows\\win.ini",
  "file\0name.md",
  "\0",
  "",
  "   ",
  ".",
  "./.",
  "....//....//etc/passwd",
  "‥/‥/etc/passwd",
  "．．/．．/etc/passwd",
  "~/.ssh/id_rsa",
  "$HOME/.bashrc",
  "%00../../etc/passwd",
  "..%c0%af..%c0%afetc",
  "nonexistent-fuzz-file.md",
  "../".repeat(2000) + "etc/passwd",
];

async function expectSafeRejection(fn: () => Promise<unknown>): Promise<void> {
  let message = "";
  try {
    await fn();
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toMatch(/Invalid memory file name|Memory file not found/);
}

describe("memory path traversal fuzz", () => {
  test("fixed traversal payloads are rejected by delete and edit", async () => {
    for (const payload of FIXED_PAYLOADS) {
      const candidate = candidatePath(payload);
      if (candidate && existsSync(candidate)) continue;
      await expectSafeRejection(() => handleMemoryDelete(payload));
      await expectSafeRejection(() => handleMemoryDelete(payload, 0));
      await expectSafeRejection(() => handleMemoryEdit(payload, 0, "pwned"));
    }
  });

  test("random traversal payloads are rejected by delete and edit", async () => {
    for (let i = 0; i < 200; i++) {
      const payload = randomTraversalPayload();
      const candidate = candidatePath(payload);
      if (candidate && existsSync(candidate)) continue;
      await expectSafeRejection(() => handleMemoryDelete(payload));
      await expectSafeRejection(() => handleMemoryEdit(payload, randInt(5), "pwned"));
    }
  });

  test("an absolute path to a real file outside memoryDir cannot be deleted or edited", async () => {
    const candidate = candidatePath(sentinelFile);
    expect(candidate).not.toBeNull();
    if (!existsSync(candidate!)) {
      await expectSafeRejection(() => handleMemoryDelete(sentinelFile));
      await expectSafeRejection(() => handleMemoryEdit(sentinelFile, 0, "pwned"));
    }
    const traversal = `../..${sentinelFile}`;
    const traversalCandidate = candidatePath(traversal);
    if (traversalCandidate && !existsSync(traversalCandidate)) {
      await expectSafeRejection(() => handleMemoryDelete(traversal));
    }
    expect(existsSync(sentinelFile)).toBe(true);
    expect(readFileSync(sentinelFile, "utf-8")).toContain("do not touch");
  });

  test("system files targeted by traversal are untouched", () => {
    if (existsSync("/etc/passwd")) {
      expect(readFileSync("/etc/passwd", "utf-8").length).toBeGreaterThan(0);
    }
  });

  test("memoryDir contents are unchanged after all fuzzing", () => {
    expect(listMemoryDir()).toEqual(memoryListingBefore);
  });
});
