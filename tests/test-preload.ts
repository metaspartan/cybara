import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ownsIsolatedHome = process.env.CYBARA_TEST_ISOLATED !== "1";
const realHome = process.env.CYBARA_TEST_REAL_HOME || process.env.HOME || "";
const isolatedRoot = ownsIsolatedHome ? mkdtempSync(join(tmpdir(), "cybara-tests-")) : null;

if (isolatedRoot) {
  process.env.HOME = isolatedRoot;
  process.env.USERPROFILE = isolatedRoot;
  process.env.CYBARA_HOME = join(isolatedRoot, ".cybara");
  process.env.CYBARA_TEST_ISOLATED = "1";
  process.env.CYBARA_TEST_REAL_HOME = realHome;
}

afterAll(() => {
  if (!isolatedRoot) return;
  try {
    rmSync(isolatedRoot, { recursive: true, force: true });
  } catch {
    void 0;
  }
});
