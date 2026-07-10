import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "playwright";

type ChromiumBrowserType = typeof import("playwright")["chromium"];

export function windowsBrowserCdpArgs(
  userDataDir: string,
  headless: boolean,
  extraArgs: string[] = []
): string[] {
  return [
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-extensions",
    "--disable-sync",
    "--disable-gpu",
    ...(headless ? ["--headless=new"] : []),
    ...extraArgs,
  ];
}

function readCdpPort(activePortPath: string): number | null {
  if (!existsSync(activePortPath)) return null;
  try {
    const firstLine = readFileSync(activePortPath, "utf8").split(/\r?\n/, 1)[0]?.trim();
    const port = Number(firstLine);
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
  } catch {
    return null;
  }
}

async function waitForCdpPort(
  activePortPath: string,
  process: ReturnType<typeof Bun.spawn>,
  timeoutMs: number
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const port = readCdpPort(activePortPath);
    if (port !== null) return port;
    if (process.exitCode !== null) {
      throw new Error(`browser exited with code ${process.exitCode}`);
    }
    await Bun.sleep(100);
  }
  throw new Error(`browser debugging endpoint was not ready within ${timeoutMs}ms`);
}

export async function launchWindowsBrowserOverCdp(
  chromium: ChromiumBrowserType,
  executablePath: string,
  headless: boolean,
  extraArgs: string[],
  timeoutMs: number
): Promise<Browser> {
  const userDataDir = mkdtempSync(join(tmpdir(), "cybara-browser-"));
  const child = Bun.spawn({
    cmd: [executablePath, ...windowsBrowserCdpArgs(userDataDir, headless, extraArgs)],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderrPromise = new Response(child.stderr).text();

  const cleanup = async (): Promise<void> => {
    if (child.exitCode === null) child.kill();
    await Promise.race([child.exited.then(() => undefined), Bun.sleep(2_000)]);
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };

  try {
    const startedAt = Date.now();
    const port = await waitForCdpPort(join(userDataDir, "DevToolsActivePort"), child, timeoutMs);
    const remainingMs = Math.max(1_000, timeoutMs - (Date.now() - startedAt));
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      timeout: remainingMs,
    });
    browser.on("disconnected", () => void cleanup());
    return browser;
  } catch (error) {
    await cleanup();
    const stderr = (await stderrPromise).trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(stderr ? `${message}: ${stderr.slice(-2_000)}` : message);
  }
}
