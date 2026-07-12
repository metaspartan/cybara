import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const root = join(import.meta.dirname, "..");
const source = join(root, "ui", "dist");
const target = join(root, "src-tauri", "bin", "ui", "dist");

export function stageTauriUi(sourceDir: string = source, targetDir: string = target): void {
  if (!existsSync(join(sourceDir, "index.html"))) {
    throw new Error(`Built UI not found at ${sourceDir}`);
  }
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(join(targetDir, ".."), { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true });
}

if (import.meta.main) {
  await $`bun run ui:build`;
  stageTauriUi();
}
