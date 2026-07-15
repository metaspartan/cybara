function normalize(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

export function isCybaraProfileProcess(command: string, repoRoot: string): boolean {
  const normalized = normalize(command);
  if (normalized.includes("profile-cybara-macos")) return false;
  if (normalized.includes("/.cybara/browser/")) return true;
  if (normalized.includes("cybaranative.app/")) return true;
  if (normalized.includes("/cybara.app/")) return true;

  const root = normalize(repoRoot).replace(/\/$/, "");
  if (normalized.includes(`${root}/ui/node_modules/.bin/vite`)) return true;
  if (normalized.includes(`${root}/src-tauri/target/debug/cybara`)) return true;
  if (normalized.includes(`${root}/src-tauri/target/release/cybara`)) return true;
  if (normalized.includes(`${root}/src-tauri/bin/cybara-`)) return true;

  return /(?:^|\s)bun(?:\s+run)?\s+(?:\.\/)?(?:src\/index\.ts|dist\/index\.js)(?:\s|$)/.test(
    normalized
  );
}
