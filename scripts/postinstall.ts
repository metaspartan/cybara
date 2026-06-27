#!/usr/bin/env bun
import { $ } from "bun";

interface PostinstallDeps {
  installUi: () => Promise<void>;
  installPlaywright: () => Promise<void>;
  warn: (message: string) => void;
}

const defaultDeps: PostinstallDeps = {
  installUi: async () => {
    await $`cd ui && bun install`;
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

  // Skip Playwright browser download when PUPPETEER_SKIP_DOWNLOAD is set
  // (CI builds don't need browser binaries for compiling server binaries).
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
