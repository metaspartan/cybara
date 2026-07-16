import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIDECAR_SCRIPT = join(ROOT_DIR, "scripts", "build-sidecar.ts");
const CI_INSTALL_SCRIPT = join(ROOT_DIR, "scripts", "ci-install.sh");
const PACKAGE_SCRIPT = join(ROOT_DIR, "scripts", "package.ts");
const REACT_DOCTOR_SCRIPT = join(ROOT_DIR, "scripts", "react-doctor.ts");
const SMOKE_TEST_SCRIPT = join(ROOT_DIR, "scripts", "run-smoke-tests.ts");
const KNIP_CONFIG = join(ROOT_DIR, "knip.json");

describe("package.json script wiring", () => {
  test("exposes cybara CLI bin and expected build/dev scripts", () => {
    const pkgPath = join(ROOT_DIR, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      name?: string;
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.name).toBe("cybara");
    expect(pkg.bin?.cybara).toBe("./dist/main.js");

    expect(pkg.scripts?.["postinstall"]).toBe("bun run scripts/postinstall.ts");
    expect(pkg.scripts?.["tauri:sidecar"]).toBe("bun run scripts/build-sidecar.ts");
    expect(pkg.scripts?.["tauri:prepare-release"]).toBe("bun run scripts/prepare-tauri-release.ts");
    expect(pkg.scripts?.["tauri:build:release"]).toContain("bun run tauri:prepare-release");
    expect(pkg.scripts?.["native:macos:build"]).toBe(
      "swift build --package-path apps/macos/Cybara"
    );
    expect(pkg.scripts?.["native:macos:run"]).toContain("bun run ui:build");
    expect(pkg.scripts?.["native:macos:run"]).toContain("bun run tauri:sidecar");
    expect(pkg.scripts?.["native:macos:run"]).toContain(
      "swift run --package-path apps/macos/Cybara"
    );
    expect(pkg.scripts?.["native:macos:package"]).toBe("bun run scripts/package-native-macos.ts");
    expect(pkg.scripts?.["mobile:dev"]).toBe("cd apps/mobile && bun run dev");
    expect(pkg.scripts?.["mobile:ios"]).toBe("cd apps/mobile && bun run ios");
    expect(pkg.scripts?.["mobile:android"]).toBe("cd apps/mobile && bun run android");
    expect(pkg.scripts?.["mobile:expo-check"]).toBe("cd apps/mobile && bunx expo install --check");
    expect(pkg.scripts?.["mobile:typecheck"]).toBe("cd apps/mobile && bun run typecheck");
    expect(pkg.scripts?.["doctor"]).toBe("bun run scripts/react-doctor.ts");
    const reactDoctorSource = readFileSync(REACT_DOCTOR_SCRIPT, "utf8");
    expect(reactDoctorSource).toContain('"ui,apps/mobile"');
    expect(reactDoctorSource).toContain('"lines"');
    expect(reactDoctorSource).toContain('"--no-score"');
    expect(reactDoctorSource).toContain('"error"');
    expect(reactDoctorSource).toContain('environment.CI === "true"');
    expect(reactDoctorSource).toContain('Bun.spawnSync(["git", "rev-parse", "HEAD^"]');
    expect(pkg.scripts?.["test:mobile"]).toBe("bun run test:isolated tests/mobile");
    expect(pkg.scripts?.["test:smoke"]).toBe("bun run scripts/run-smoke-tests.ts");
    const smokeTestSource = readFileSync(SMOKE_TEST_SCRIPT, "utf8");
    expect(smokeTestSource).toContain('name: "core", paths: ["tests/core"]');
    expect(smokeTestSource).toContain('name: "mobile", paths: ["tests/mobile"]');
    expect(smokeTestSource).toContain('name: "ui", paths: ["tests/ui"]');
    expect(smokeTestSource).toContain('name: "cli", paths: ["tests/cli"]');
    expect(smokeTestSource).toContain('name: "tauri", paths: ["tests/tauri"]');
    expect(smokeTestSource).toContain("tests/e2e/security-auth-smoke.test.ts");
    expect(smokeTestSource).toContain("tests/api/security.test.ts");
    expect(smokeTestSource).toContain("CYBARA_SMOKE_WORKERS");
    expect(pkg.scripts?.["check:ci"]).toContain("bun run mobile:expo-check");
    expect(pkg.scripts?.["check:ci"]).toContain("bun run mobile:typecheck");
    expect(pkg.scripts?.["check:ci"]).toContain("bun run doctor");
    expect(pkg.scripts?.["format"]).toBe("biome format --write");
    expect(pkg.scripts?.["format:check"]).toBe("biome format");
    expect(pkg.scripts?.["deadcode"]).toBe("knip --no-progress");
    expect(pkg.scripts?.["check:ci"]).toContain("bun run format:check");
    expect(pkg.scripts?.["check:ci"]).toContain("bun run deadcode");
    expect(pkg.devDependencies?.["@biomejs/biome"]).toMatch(/^\d+\.\d+\.\d+/);
    expect(pkg.devDependencies?.["knip"]).toMatch(/^\d+\.\d+\.\d+/);
    expect(pkg.devDependencies?.["react-doctor"]).toBe("0.7.8");
    const knipConfig = JSON.parse(readFileSync(KNIP_CONFIG, "utf8")) as {
      workspaces?: Record<string, { ignoreDependencies?: string[] }>;
    };
    const ignoredDependencies = knipConfig.workspaces?.["."]?.ignoreDependencies ?? [];
    expect(ignoredDependencies).toContain("react-doctor");
    expect(ignoredDependencies).toEqual(
      expect.arrayContaining([
        "@vtsls/language-server",
        "bash-language-server",
        "vscode-langservers-extracted",
        "yaml-language-server",
      ])
    );
    expect(pkg.devDependencies?.["prettier"]).toBeUndefined();
    expect(pkg.devDependencies?.["eslint-plugin-prettier"]).toBeUndefined();
    expect(pkg.devDependencies?.["eslint-config-prettier"]).toBeUndefined();

    expect(pkg.scripts?.["build:all"]).toContain("bun run ui:build");
    expect(pkg.scripts?.["build:all"]).toContain("bun run build:cli");
    expect(pkg.scripts?.["build:all"]).toContain("bun run build:main");
    expect(pkg.scripts?.["build:cli"]).toContain("--outfile dist/cli.js");
    expect(pkg.scripts?.["audit:ci"]).toContain("bun run audit:site");
    expect(pkg.scripts?.["build"]).not.toContain("--external @noble/hashes");
    expect(pkg.scripts?.["build:cli"]).not.toContain("--external @scure/bip39");
    expect(pkg.scripts?.["build:main"]).not.toContain("--external @scure/base");
    expect(pkg.scripts?.["build"]).toContain("--external tiny-secp256k1");
    expect(pkg.scripts?.["build:cli"]).toContain("--external tiny-secp256k1");
    expect(pkg.scripts?.["build:main"]).toContain("--external tiny-secp256k1");
    expect((pkg as Record<string, unknown>)["build"]).toBeUndefined();
    expect((pkg as Record<string, unknown>)["build:cli"]).toBeUndefined();
    expect((pkg as Record<string, unknown>)["build:main"]).toBeUndefined();
    expect(readFileSync(SIDECAR_SCRIPT, "utf8")).toContain("--external @aws-sdk/client-s3");
    expect(readFileSync(PACKAGE_SCRIPT, "utf8")).toContain("--external tiny-secp256k1");
    expect(readFileSync(PACKAGE_SCRIPT, "utf8")).toContain(
      'const cliOutput = join(DIST_DIR, "cli.js")'
    );

    expect(pkg.scripts?.["tauri:dev"]).toContain("bun run tauri:sidecar");
    expect(pkg.scripts?.["tauri:dev"]).toContain("bunx tauri dev");
    expect(pkg.scripts?.["tauri:dev:prep"]).toContain("bun run package");
  });

  test("CI install retries clean partial node_modules after tarball extraction failures", () => {
    const source = readFileSync(CI_INSTALL_SCRIPT, "utf8");

    expect(source).toContain("removing partial install state");
    expect(source).toContain("rm -rf node_modules");
    expect(source).toContain('if [ "$i" -ge "$attempts" ]; then');
    expect(source).toContain("bun pm cache rm || true");
  });
});
