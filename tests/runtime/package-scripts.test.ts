import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("package.json script wiring", () => {
  test("exposes cybara CLI bin and expected build/dev scripts", () => {
    const pkgPath = join(ROOT_DIR, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      name?: string;
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(pkg.name).toBe("cybara");
    expect(pkg.bin?.cybara).toBe("./dist/main.js");

    expect(pkg.scripts?.["postinstall"]).toBe("bun run scripts/postinstall.ts");
    expect(pkg.scripts?.["tauri:sidecar"]).toBe("bun run scripts/build-sidecar.ts");

    expect(pkg.scripts?.["build:all"]).toContain("bun run ui:build");
    expect(pkg.scripts?.["build:all"]).toContain("bun run build:cli");
    expect(pkg.scripts?.["build:all"]).toContain("bun run build:main");

    expect(pkg.scripts?.["tauri:dev"]).toContain("bun run tauri:sidecar");
    expect(pkg.scripts?.["tauri:dev"]).toContain("--enable-terminal");
    expect(pkg.scripts?.["tauri:dev"]).toContain("bunx tauri dev");
  });
});
