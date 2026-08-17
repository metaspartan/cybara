import { expect, test } from "bun:test";
import { readSubprocessStreamAsText } from "../../src/core/subprocess-output";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");

test("repository test runner isolates persistent Cybara state before imports", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "scripts/run-tests-isolated.ts",
      "tests/fixtures/isolated-home-probe.test.ts",
    ],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    readSubprocessStreamAsText(child.stdout),
    readSubprocessStreamAsText(child.stderr),
  ]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
});

test("repository test runner uses a bounded timeout under parallel smoke load", async () => {
  const source = await Bun.file(join(root, "scripts", "run-tests-isolated.ts")).text();
  expect(source).toContain('process.env.CYBARA_TEST_TIMEOUT_MS ?? "15000"');
  expect(source).toContain('"--timeout", String(boundedTimeoutMs)');
});
