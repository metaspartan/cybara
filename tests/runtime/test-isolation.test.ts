import { expect, test } from "bun:test";
import { join } from "path";

test("repository test runner isolates persistent Cybara state before imports", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "scripts/run-tests-isolated.ts",
      "tests/fixtures/isolated-home-probe.test.ts",
    ],
    {
      cwd: join(import.meta.dir, "..", ".."),
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
});
