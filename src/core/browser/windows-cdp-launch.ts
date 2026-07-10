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
  const process = Bun.spawn({
    cmd: [executablePath, ...windowsBrowserCdpArgs(userDataDir, headless, extraArgs)],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

  const cleanup = (): void => {
    if (process.exitCode === null) process.kill();
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
  };

  try {
    const port = await waitForCdpPort(join(userDataDir, "DevToolsActivePort"), process, timeoutMs);
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
      timeout: timeoutMs,
    });
    browser.on("disconnected", cleanup);
    return browser;
  } catch (error) {
    cleanup();
    throw error;
  }
}
