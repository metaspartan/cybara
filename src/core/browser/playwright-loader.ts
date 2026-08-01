import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

type ChromiumApi = typeof import("playwright")["chromium"];

let cached: ChromiumApi | null = null;

async function importModule(specifier: string): Promise<Record<string, unknown>> {
  return (await import(specifier)) as Record<string, unknown>;
}

export function stripWindowsLongPathPrefix(value: string): string {
  if (value.startsWith("\\\\?\\UNC\\")) return `\\\\${value.slice(8)}`;
  if (value.startsWith("\\\\?\\")) return value.slice(4);
  return value;
}

function candidateRoots(): string[] {
  const seeds = [
    process.env.CYBARA_PLAYWRIGHT_RESOURCE_DIR,
    process.env.CYBARA_RESOURCE_DIR,
    process.cwd(),
    (() => {
      try {
        return dirname(process.execPath);
      } catch {
        return undefined;
      }
    })(),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map(stripWindowsLongPathPrefix);

  const roots: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    let current = seed;
    for (let depth = 0; depth < 6; depth += 1) {
      if (!seen.has(current)) {
        seen.add(current);
        roots.push(current);
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return roots;
}

export function findHermeticPlaywrightBrowserPath(
  roots: string[] = candidateRoots()
): string | null {
  const nodeModuleParents = ["", "bin", "resources", join("resources", "bin")];
  for (const root of roots) {
    for (const parent of nodeModuleParents) {
      const browserRoot = join(root, parent, "node_modules", "playwright-core", ".local-browsers");
      if (!existsSync(browserRoot)) continue;
      try {
        if (readdirSync(browserRoot).length === 0) continue;
      } catch {
        continue;
      }
      return browserRoot;
    }
  }
  return null;
}

export function configureHermeticPlaywrightBrowserPath(
  roots: string[] = candidateRoots(),
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (env.PLAYWRIGHT_BROWSERS_PATH?.trim()) return null;
  const browserRoot = findHermeticPlaywrightBrowserPath(roots);
  if (!browserRoot) return null;
  env.PLAYWRIGHT_BROWSERS_PATH = "0";
  return browserRoot;
}

function playwrightEntryCandidates(): string[] {
  const files = ["index.mjs", "index.js"];
  const packages = ["playwright", "playwright-core"];
  const nodeModuleParents = ["", "bin", "resources", join("resources", "bin")];
  const candidates: string[] = [];
  for (const root of candidateRoots()) {
    for (const parent of nodeModuleParents) {
      for (const pkg of packages) {
        for (const file of files) {
          candidates.push(join(root, parent, "node_modules", pkg, file));
        }
      }
    }
  }
  return candidates;
}

function resolveChromium(mod: Record<string, unknown>): ChromiumApi | undefined {
  const direct = mod.chromium as ChromiumApi | undefined;
  if (direct) return direct;
  const fromDefault = (mod.default as Record<string, unknown> | undefined)?.chromium as
    | ChromiumApi
    | undefined;
  return fromDefault;
}

export async function getChromium(): Promise<ChromiumApi> {
  if (cached) return cached;

  configureHermeticPlaywrightBrowserPath();

  const failures: string[] = [];

  try {
    const resolved = resolveChromium(await importModule("playwright"));
    if (resolved) {
      cached = resolved;
      return cached;
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }

  for (const candidate of playwrightEntryCandidates()) {
    if (!existsSync(candidate)) continue;
    try {
      const resolved = resolveChromium(
        (await import(pathToFileURL(candidate).href)) as Record<string, unknown>
      );
      if (resolved) {
        cached = resolved;
        return cached;
      }
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `playwright chromium runtime is unavailable${failures.length ? ` (${failures.join(" | ")})` : ""}`
  );
}
