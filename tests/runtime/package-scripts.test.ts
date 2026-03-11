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
    expect(pkg.scripts?.["tauri:prepare-release"]).toBe("bun run scripts/prepare-tauri-release.ts");
    expect(pkg.scripts?.["tauri:build:release"]).toContain("bun run tauri:prepare-release");
    expect(pkg.scripts?.["native:macos:build"]).toBe("swift build --package-path apps/macos/Cybara");
    expect(pkg.scripts?.["native:macos:run"]).toBe("swift run --package-path apps/macos/Cybara");
    expect(pkg.scripts?.["native:macos:package"]).toBe("bun run scripts/package-native-macos.ts");

    expect(pkg.scripts?.["build:all"]).toContain("bun run ui:build");
    expect(pkg.scripts?.["build:all"]).toContain("bun run build:cli");
    expect(pkg.scripts?.["build:all"]).toContain("bun run build:main");

    expect(pkg.scripts?.["tauri:dev"]).toContain("bun run tauri:sidecar");
    expect(pkg.scripts?.["tauri:dev"]).toContain("bunx tauri dev");
    expect(pkg.scripts?.["tauri:dev:prep"]).toContain("bun run package");
  });
});
