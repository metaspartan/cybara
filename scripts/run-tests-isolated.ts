import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "cybara-tests-"));
const cybaraHome = join(root, ".cybara");

try {
  const child = Bun.spawn([process.execPath, "test", ...process.argv.slice(2)], {
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
  });
  process.exitCode = await child.exited;
} finally {
  rmSync(root, { recursive: true, force: true });
}
