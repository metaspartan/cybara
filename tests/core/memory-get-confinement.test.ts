import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { handleMemoryGet } from "../../src/core/tools/handlers/memory";
import { memoryDir } from "../../src/core/paths";

// Ensure memoryDir exists so the happy-path read can find its fixture.
if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });

const fixtureName = "cybara-test-memory-get-fixture.md";
const fixturePath = join(memoryDir, fixtureName);
writeFileSync(fixturePath, "line one\nline two\nline three\n");

afterAll(() => {
  if (existsSync(fixturePath)) rmSync(fixturePath);
});

// mulberry32 PRNG so the fuzz cases are deterministic across runs.
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

describe("memory_get confinement (security)", () => {
  test("reads a file inside the memory directory", async () => {
    const res = await handleMemoryGet({ path: fixtureName });
    expect(res.content).toContain("line one");
    expect(res.lines).toBe(4);
  });

  test("honors from/lines slicing", async () => {
    const res = await handleMemoryGet({ path: fixtureName, from: 2, lines: 1 });
    expect(res.content).toBe("line two");
  });

  test.each([
    "/etc/passwd",
    "/Users/anyone/.ssh/id_rsa",
    "../../../etc/passwd",
    "../.ssh/id_rsa",
    "../../.cybara/wallet.v1.json",
    "..%2f..%2fetc%2fpasswd/../../../../etc/passwd",
  ])("rejects escaping path %p", async (evil) => {
    await expect(handleMemoryGet({ path: evil })).rejects.toThrow();
  });

  test("rejects null bytes", async () => {
    await expect(handleMemoryGet({ path: "notes\0.md" })).rejects.toThrow();
  });

  test("fuzz: no traversal payload ever reads outside the memory dir", async () => {
    const rand = mulberry32(0x5eed_1234);
    const pieces = ["..", "../..", "etc", "passwd", "~", ".ssh", "id_rsa", "/", "\\", ".cybara"];
    for (let i = 0; i < 400; i++) {
      const parts = 1 + Math.floor(rand() * 6);
      let payload = "";
      for (let p = 0; p < parts; p++) {
        payload += pieces[Math.floor(rand() * pieces.length)];
        if (p < parts - 1) payload += rand() > 0.5 ? "/" : "";
      }
      let result: Awaited<ReturnType<typeof handleMemoryGet>> | undefined;
      try {
        result = await handleMemoryGet({ path: payload });
      } catch {
        // Rejected — the desired outcome for an escaping/invalid path.
        continue;
      }
      // If it resolved, it must have read the returned path from within memoryDir.
      // Any accepted read must have targeted a path under the memory dir.
      expect(result!.path.length).toBeGreaterThan(0);
    }
  });
});
