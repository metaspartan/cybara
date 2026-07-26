#!/usr/bin/env bun
import { $ } from "bun";

interface PostinstallDeps {
  installUi: () => Promise<void>;
  installMobile: () => Promise<void>;
  installPlaywright: () => Promise<void>;
  warn: (message: string) => void;
}

export interface RetryInstallOptions {
  attempts?: number;
  label?: string;
  cleanup?: (attempt: number) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  warn?: (message: string) => void;
}

export async function retryInstall(
  run: () => Promise<void>,
  options: RetryInstallOptions = {}
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const label = options.label ?? "install";
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const warn = options.warn ?? ((message: string) => console.warn(message));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await run();
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      warn(
        `[postinstall] ${label} failed (attempt ${attempt}/${attempts}); clearing cache and retrying`
      );
      try {
        await options.cleanup?.(attempt);
      } catch {}
      await sleep(attempt * 5000);
    }
  }
  throw lastError;
}

function bunInstallDirCleanup(dir: string): (attempt: number) => Promise<void> {
  return async () => {
    await $`rm -rf ${dir}/node_modules`.nothrow();
    await $`bun pm cache rm`.nothrow();
  };
}

const defaultDeps: PostinstallDeps = {
  installUi: async () => {
    await retryInstall(
      async () => {
        await $`cd ui && bun install`;
      },
      { label: "ui bun install", cleanup: bunInstallDirCleanup("ui") }
    );
  },
  installMobile: async () => {
    await retryInstall(
      async () => {
        await $`cd apps/mobile && bun install`;
      },
      { label: "mobile bun install", cleanup: bunInstallDirCleanup("apps/mobile") }
    );
  },
  installPlaywright: async () => {
    await $`bunx playwright install`;
  },
  warn: (message: string) => {
    console.warn(message);
  },
};

export async function runPostinstall(deps: Partial<PostinstallDeps> = {}): Promise<void> {
  const resolved: PostinstallDeps = { ...defaultDeps, ...deps };
  await resolved.installUi();
  await resolved.installMobile();

  if (process.env.PUPPETEER_SKIP_DOWNLOAD === "true" || process.env.CI === "true") {
    resolved.warn("[postinstall] Skipping Playwright browser install (CI/build mode).");
    return;
  }

  try {
    await resolved.installPlaywright();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    resolved.warn("[postinstall] Playwright browser install skipped.");
    resolved.warn("[postinstall] This does not affect non-browser features/tests.");
    resolved.warn(`[postinstall] Reason: ${message}`);
  }
}

if (import.meta.main) {
  runPostinstall().catch((error) => {
    console.error("[postinstall] Failed:", error);
    process.exit(1);
  });
}
