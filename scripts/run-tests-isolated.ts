import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "cybara-tests-"));
const cybaraHome = join(root, ".cybara");
const timeoutMs = Number.parseInt(process.env.CYBARA_TEST_TIMEOUT_MS ?? "15000", 10);
const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 5000 ? timeoutMs : 15000;

try {
  const child = Bun.spawn(
    [
      process.execPath,
      "test",
      "--parallel",
      "--timeout",
      String(boundedTimeoutMs),
      ...process.argv.slice(2),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        CYBARA_HOME: cybaraHome,
        CYBARA_TEST_ISOLATED: "1",
        CYBARA_TEST_REAL_HOME: process.env.CYBARA_TEST_REAL_HOME || process.env.HOME || "",
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }
  );
  process.exitCode = await child.exited;
} finally {
  rmSync(root, { recursive: true, force: true });
}
