import { mkdtempSync } from "fs";
import { removeTestHome } from "./test-home-cleanup";
import { homedir, tmpdir } from "os";
import { testBrowserCachePath } from "./test-browser-cache";
import { join } from "path";

const root = mkdtempSync(join(tmpdir(), "cybara-tests-"));
const cybaraHome = join(root, ".cybara");
const realHome = process.env.CYBARA_TEST_REAL_HOME || process.env.HOME || homedir();
const timeoutMs = Number.parseInt(process.env.CYBARA_TEST_TIMEOUT_MS ?? "15000", 10);
const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 5000 ? timeoutMs : 15000;
const testFlags = ["test", "--timeout", String(boundedTimeoutMs)];
if (process.env.CYBARA_TEST_PARALLEL === "1") testFlags.splice(1, 0, "--parallel");

try {
  const child = Bun.spawn([process.execPath, ...testFlags, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      CONFIG_DIR: cybaraHome,
      CYBARA_RESOURCE_DIR: undefined,
      CYBARA_PLUGIN_DIR: undefined,
      CYBARA_COMPILED: undefined,
      CYBARA_UI_DIR: undefined,
      CYBARA_API_KEY: undefined,
      CYBARA_HOME: cybaraHome,
      PLAYWRIGHT_BROWSERS_PATH: testBrowserCachePath(process.platform, process.env, realHome),
      CYBARA_TEST_ISOLATED: "1",
      CYBARA_TEST_REAL_HOME: realHome,
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await child.exited;
} finally {
  await removeTestHome(root);
}
