import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT_DIR, rel), "utf8");
}

describe("app release surface wiring", () => {
  test("CI gates every pull request, merge queue, and release branch", () => {
    const ciWorkflow = read(".github/workflows/ci.yml");

    expect(ciWorkflow).toContain("pull_request: {}");
    expect(ciWorkflow).toContain("merge_group: {}");
    expect(ciWorkflow).toMatch(/branches:\s+\- main\s+\- master\s+\- dev/);
    expect(ciWorkflow).toContain("bun run check:ci");
    expect(ciWorkflow).toContain("bun run audit:ci");
    expect(ciWorkflow).toContain("bun run build:all");
    expect(ciWorkflow).toContain("cd site && bun run build");
    expect(ciWorkflow).toContain("bunx expo export --platform ios");
    expect(ciWorkflow).toContain("bunx expo export --platform android");
  });

  test("CI quality gates sync mobile release metadata before checks", () => {
    const ciWorkflow = read(".github/workflows/ci.yml");
    const releaseWorkflow = read(".github/workflows/release.yml");
    const versionWorkflow = read(".github/workflows/main-version-tag.yml");

    expect(ciWorkflow).toContain('CYBARA_RELEASE_VERSION="$VERSION" bun run version:sync');
    expect(ciWorkflow.indexOf("name: Sync version metadata")).toBeLessThan(
      ciWorkflow.indexOf("name: Run CI checks")
    );
    expect(releaseWorkflow.indexOf("name: Sync version metadata")).toBeLessThan(
      releaseWorkflow.indexOf("name: Run CI checks")
    );
    expect(releaseWorkflow.slice(0, releaseWorkflow.indexOf("build-cli:"))).toContain(
      "fetch-depth: 2"
    );
    expect(versionWorkflow).toContain("apps/mobile/app.json");
    expect(versionWorkflow).toContain("nix/release.nix");
    expect(versionWorkflow).toContain(
      "git add package.json ui/package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json apps/mobile/app.json nix/release.nix"
    );
  });

  test("release workflow keeps mobile Expo bundles gated by dependency and type checks", () => {
    const workflow = read(".github/workflows/release.yml");

    expect(workflow).toContain("build-mobile:");
    expect(workflow).toContain("name: Mobile Expo bundles");
    expect(workflow).toContain("uses: actions/setup-node@");
    expect(workflow).toContain("bun run mobile:expo-check");
    expect(workflow).toContain("bun run mobile:typecheck");
    expect(workflow).toContain("bunx expo export --platform ios");
    expect(workflow).toContain("bunx expo export --platform android");
    expect(workflow).toContain("cybara-mobile-expo");
  });

  test("release workflow keeps native iOS and Android builds best-effort but complete", () => {
    const workflow = read(".github/workflows/release.yml");

    expect(workflow).toContain("build-android:");
    expect(workflow).toContain("name: Android APK");
    expect(workflow).toContain("android-actions/setup-android@");
    expect(workflow).toContain(
      "cd apps/mobile && bunx expo prebuild --platform android --no-install"
    );
    expect(workflow).toContain("name: Tune Android Gradle memory");
    expect(workflow).toContain("MaxMetaspaceSize=1536m");
    expect(workflow).toContain("kotlin.daemon.jvmargs");
    expect(workflow).toContain("org.gradle.workers.max");
    expect(workflow.indexOf("name: Prebuild Android project")).toBeLessThan(
      workflow.indexOf("name: Tune Android Gradle memory")
    );
    expect(workflow.indexOf("name: Tune Android Gradle memory")).toBeLessThan(
      workflow.indexOf("name: Build Android artifacts")
    );
    expect(workflow).toContain("./gradlew bundleRelease assembleRelease");
    expect(workflow).toContain("./gradlew assembleDebug");
    expect(workflow).toContain("packageName: com.ck.cybara");
    expect(workflow).toContain(
      "GOOGLE_PLAY_PUBLISH_CONFIGURED: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON != '' }}"
    );
    expect(workflow).toContain(
      "if: steps.build.outputs.aab != '' && env.GOOGLE_PLAY_PUBLISH_CONFIGURED == 'true'"
    );
    expect(workflow).toContain("tracks: internal");
    expect(workflow).not.toContain("track: internal");

    expect(workflow).toContain("build-ios:");
    expect(workflow).toContain("name: iOS build");
    expect(workflow).toContain("runs-on: macos-26");
    expect(workflow).toContain("cd apps/mobile && bunx expo prebuild --platform ios --no-install");
    expect(workflow).toContain("cd apps/mobile/ios && pod install --repo-update");
    expect(workflow).toContain("xcodebuild -list -json");
    expect(workflow).toContain("xcodebuild -workspace");
    expect(workflow).toContain("name: Reclaim iOS build space");
    expect(workflow).toContain("archive_ios()");
    expect(workflow).toContain("Input/output error|No space left on device");
    expect(workflow).toContain("<key>method</key><string>app-store-connect</string>");
    expect(workflow).toContain("bun run scripts/upload-ios-testflight.ts");
    expect(workflow).toContain('TESTFLIGHT_UPLOAD_ATTEMPTS: "4"');
  });

  test("release workflow publishes only after the Tauri updater manifest is complete", () => {
    const workflow = read(".github/workflows/release.yml");

    expect(workflow).toContain("releaseDraft: true");
    expect(workflow).toContain("draft: true");
    expect(workflow).toContain("publish-release:");
    expect(workflow).toContain(
      "needs: [release, build-tauri, build-native-macos, build-android, build-ios]"
    );
    expect(workflow).toContain("includeUpdaterJson: false");
    expect(workflow).toContain("bun run scripts/publish-tauri-updater-manifest.ts");
    expect(workflow).toContain('gh release download "$TAG"');
    expect(workflow).toContain("darwin-aarch64,darwin-aarch64-app,darwin-x86_64");
    expect(workflow).toContain(
      "bun run scripts/verify-tauri-updater-manifest.ts release-check/latest.json"
    );
    expect(workflow).toContain('gh release edit "$TAG" --repo "$GITHUB_REPOSITORY" --draft=false');
    expect(workflow).not.toContain("releaseDraft: false");
  });

  test("release workflow synchronizes Nix hashes before publishing without a delayed package job", () => {
    const releaseWorkflow = read(".github/workflows/release.yml");
    const packageWorkflow = read(".github/workflows/publish-packages.yml");

    expect(releaseWorkflow).toContain("name: Sync Nix release hashes");
    expect(releaseWorkflow).toContain('bun run scripts/sync-nix-release.ts "$VERSION"');
    expect(releaseWorkflow.indexOf("name: Sync Nix release hashes")).toBeLessThan(
      releaseWorkflow.indexOf("name: Publish draft release")
    );
    expect(packageWorkflow).not.toContain("Regenerate nix/release.nix");
    expect(packageWorkflow).not.toContain("git add nix/release.nix");
  });

  test("Tauri release matrix builds each platform sidecar with an explicit Bun target", () => {
    const workflow = read(".github/workflows/release.yml");
    const tauriConfig = read("src-tauri/tauri.conf.json");
    const sidecarBuilder = read("scripts/build-sidecar.ts");

    expect(workflow).toContain("Build Sidecar binary");
    expect(workflow).toContain("CYBARA_SIDECAR_BUN_TARGET: ${{ matrix.bun_target }}");
    expect(workflow).toContain("run: bun run scripts/build-sidecar.ts");
    expect(workflow).toContain("name: Install Windows browser preview runtime");
    expect(workflow).toContain('PLAYWRIGHT_BROWSERS_PATH: "0"');
    expect(workflow).toContain("bunx playwright install --only-shell chromium");
    expect(workflow).toContain("Sign Tauri sidecar runtime resources (macOS)");
    expect(workflow).toContain("run: bun run scripts/codesign-tauri-sidecar-runtime.ts");
    expect(workflow).toContain("id: build_tauri_notarized_macos");
    expect(workflow).toContain("steps.build_tauri_notarized_macos.outcome == 'failure'");
    expect(workflow).toContain(
      'rm -rf "src-tauri/target/${{ matrix.rust_target }}/release/bundle/dmg"'
    );
    expect(workflow).toContain("name: Retry Tauri App (signed and notarized macOS)");
    expect(workflow).toContain("bun_target: bun-darwin-arm64");
    expect(workflow).toContain('sidecar: "src-tauri/bin/cybara-aarch64-apple-darwin"');
    expect(workflow).toContain("bun_target: bun-darwin-x64");
    expect(workflow).toContain('sidecar: "src-tauri/bin/cybara-x86_64-apple-darwin"');
    expect(workflow).toContain("bun_target: bun-windows-x64");
    expect(workflow).toContain('sidecar: "src-tauri/bin/cybara-x86_64-pc-windows-msvc.exe"');
    expect(workflow).toContain("bun_target: bun-linux-x64");
    expect(workflow).toContain("runner: ubuntu-22.04");
    expect(workflow).toContain('sidecar: "src-tauri/bin/cybara-x86_64-unknown-linux-gnu"');
    expect(workflow).toContain('FUSE_PACKAGE="libfuse2"');
    expect(workflow).toContain("desktop-file-utils");
    expect(workflow).toContain("zsync");
    expect(workflow).toContain('args: "--bundles deb,rpm"');
    expect(workflow).toContain("name: Build Linux AppImage (best-effort)");
    expect(workflow).toContain(
      "args: --verbose --bundles appimage --config src-tauri/tauri.release.conf.json"
    );
    expect(workflow.indexOf('args: "--bundles deb,rpm"')).toBeLessThan(
      workflow.indexOf("name: Build Linux AppImage (best-effort)")
    );
    expect(tauriConfig).toContain('"bin/node_modules": "node_modules"');
    expect(tauriConfig).toContain('"bin/runtime": "runtime"');
    expect(sidecarBuilder).toContain("installBunRuntimeAt(packagedRuntimeDir, target.bunTarget)");
    expect(sidecarBuilder).toContain(
      'const playwrightPackages = ["playwright", "playwright-core"]'
    );
  });

  test("CLI release binaries embed the UI for every supported OS and architecture", () => {
    const workflow = read(".github/workflows/release.yml");
    const standaloneBuilder = read("scripts/build-standalone-cli.ts");

    expect(workflow).toContain(
      "bun run scripts/build-standalone-cli.ts bun-${{ matrix.target }} ${{ matrix.artifact }}"
    );
    expect(workflow.indexOf("- name: Build UI")).toBeLessThan(
      workflow.indexOf("- name: Cross-compile CLI binary")
    );
    for (const [target, artifact] of [
      ["linux-x64", "cybara-linux-x64"],
      ["linux-arm64", "cybara-linux-arm64"],
      ["darwin-x64", "cybara-darwin-x64"],
      ["darwin-arm64", "cybara-darwin-arm64"],
      ["windows-x64", "cybara-windows-x64.exe"],
      ["windows-arm64", "cybara-windows-arm64.exe"],
    ]) {
      expect(workflow).toContain(`target: ${target}`);
      expect(workflow).toContain(`artifact: ${artifact}`);
    }
    expect(standaloneBuilder).toContain('with { type: "file" }');
    expect(standaloneBuilder).toContain("__CYBARA_EMBEDDED_UI__");
  });

  test("Darwin x64 release artifact is smoke-tested on a macOS runner", () => {
    const workflow = read(".github/workflows/release.yml");

    expect(workflow).toContain("smoke-cli-darwin-x64:");
    expect(workflow).toContain("name: cybara-darwin-x64");
    expect(workflow).toContain("bash scripts/smoke-standalone-cli.sh ./cybara-darwin-x64");
    expect(workflow).toContain("needs: [build-cli, smoke-cli-darwin-x64, build-mobile]");
  });

  test("dev CI cross-compiles and smoke-tests the Darwin x64 CLI artifact", () => {
    const workflow = read(".github/workflows/ci.yml");

    expect(workflow).toContain("darwin-x64-cli-build:");
    expect(workflow).toContain("cd ui && bash ../scripts/ci-install.sh && bun run build");
    expect(workflow).toContain(
      "bun run scripts/build-standalone-cli.ts bun-darwin-x64 cybara-darwin-x64"
    );
    expect(workflow).toContain("name: ci-cybara-darwin-x64");
    expect(workflow).toContain("darwin-x64-cli-smoke:");
    expect(workflow).toContain("arch -x86_64 /usr/bin/true");
    expect(workflow).toContain("bash scripts/smoke-standalone-cli.sh ./cybara-darwin-x64");
  });

  test("release workflow runs native macOS unit tests when XCTest is available", () => {
    const workflow = read(".github/workflows/release.yml");

    expect(workflow).toContain("build-native-macos:");
    expect(workflow).toContain("name: Native macOS");
    expect(workflow).toContain("runs-on: ${{ matrix.runner }}");
    expect(workflow).toContain("runner: macos-26");
    expect(workflow).toContain("xcrun --find xctest");
    expect(workflow).toContain("swift test --package-path apps/macos/Cybara");
    expect(workflow).toContain("bun run scripts/package-native-macos.ts");
  });

  test("mobile app identity is shared across iOS, Android, and Expo metadata", () => {
    const appJson = JSON.parse(read("apps/mobile/app.json")) as {
      expo?: {
        name?: string;
        slug?: string;
        scheme?: string;
        version?: string;
        newArchEnabled?: boolean;
        ios?: {
          bundleIdentifier?: string;
          buildNumber?: string;
          infoPlist?: {
            NSLocalNetworkUsageDescription?: string;
            NSAppTransportSecurity?: { NSAllowsLocalNetworking?: boolean };
          };
        };
        android?: { package?: string; versionCode?: number; usesCleartextTraffic?: boolean };
        extra?: { gatewayContract?: string };
      };
    };
    const rootPkg = JSON.parse(read("package.json")) as { version?: string };
    const mobilePkg = JSON.parse(read("apps/mobile/package.json")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const versionParts = (rootPkg.version || "")
      .split(".")
      .map((part) => Number(part))
      .filter((part) => Number.isFinite(part));
    expect(versionParts).toHaveLength(3);
    const expectedVersionCode =
      versionParts[0] * 1_000_000 + versionParts[1] * 10_000 + versionParts[2];

    expect(appJson.expo?.name).toBe("Cybara");
    expect(appJson.expo?.slug).toBe("cybara-mobile");
    expect(appJson.expo?.version).toBe(rootPkg.version);
    expect(appJson.expo?.scheme).toBe("cybara");
    expect(appJson.expo?.newArchEnabled).toBe(true);
    expect(appJson.expo?.ios?.bundleIdentifier).toBe("com.ck.cybara");
    expect(appJson.expo?.ios?.buildNumber).toBe(String(expectedVersionCode));
    expect(appJson.expo?.ios?.infoPlist?.NSLocalNetworkUsageDescription).toContain(
      "Cybara gateway"
    );
    expect(appJson.expo?.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsLocalNetworking).toBe(
      true
    );
    expect(appJson.expo?.android?.package).toBe("com.ck.cybara");
    expect(appJson.expo?.android?.versionCode).toBe(expectedVersionCode);
    expect(appJson.expo?.android?.usesCleartextTraffic).toBe(true);
    expect(appJson.expo?.extra?.gatewayContract).toBe("cybara-mobile-connect-v1");

    expect(mobilePkg.scripts?.ios).toBe("bunx expo start --ios");
    expect(mobilePkg.scripts?.android).toBe("bunx expo start --android");
    expect(mobilePkg.scripts?.typecheck).toBe(
      "bun ./node_modules/@typescript/native/bin/tsc --noEmit"
    );
    expect(mobilePkg.dependencies?.["expo-glass-effect"]).toBeDefined();
    expect(mobilePkg.dependencies?.["expo-secure-store"]).toBeDefined();
  });

  test("Android app strategy remains the shared React Native companion, not a Bun runtime shell", () => {
    const readme = read("apps/android/README.md");

    expect(readme).toContain("React Native / Expo app shared with iOS");
    expect(readme).toContain("connect to a local or remote Cybara gateway");
    expect(readme).toContain("Android cannot reliably reuse the current Bun binary/runtime stack");
    expect(readme).toContain("API parity first");
  });
});
