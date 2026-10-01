import { join } from "node:path";

export function testBrowserCachePath(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  realHome: string
): string | undefined {
  if (environment.PLAYWRIGHT_BROWSERS_PATH?.trim()) return environment.PLAYWRIGHT_BROWSERS_PATH;
  if (platform === "win32")
    return environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, "ms-playwright") : undefined;
  if (!realHome) return undefined;
  return platform === "darwin"
    ? join(realHome, "Library", "Caches", "ms-playwright")
    : join(environment.XDG_CACHE_HOME || join(realHome, ".cache"), "ms-playwright");
}
