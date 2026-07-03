import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT_DIR, rel), "utf8");
}

describe("app release surface wiring", () => {
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
    expect(workflow).toContain("cd apps/mobile && bunx expo prebuild --platform android --no-install");
    expect(workflow).toContain("./gradlew bundleRelease assembleRelease");
    expect(workflow).toContain("./gradlew assembleDebug");
    expect(workflow).toContain("packageName: com.ck.cybara");

    expect(workflow).toContain("build-ios:");
    expect(workflow).toContain("name: iOS build");
    expect(workflow).toContain("runs-on: macos-26");
    expect(workflow).toContain("cd apps/mobile && bunx expo prebuild --platform ios --no-install");
    expect(workflow).toContain("cd apps/mobile/ios && pod install --repo-update");
    expect(workflow).toContain("xcodebuild -list -json");
    expect(workflow).toContain("xcodebuild -workspace");
  });

  test("release workflow publishes only after the Tauri updater manifest is complete", () => {
    const workflow = read(".github/workflows/release.yml");

    expect(workflow).toContain("releaseDraft: true");
    expect(workflow).toContain("draft: true");
    expect(workflow).toContain("publish-release:");
    expect(workflow).toContain("needs: [release, build-tauri, build-native-macos, build-android, build-ios]");
    expect(workflow).toContain("gh release download \"$TAG\"");
    expect(workflow).toContain("bun run scripts/verify-tauri-updater-manifest.ts release-check/latest.json");
    expect(workflow).toContain("gh release edit \"$TAG\" --repo \"$GITHUB_REPOSITORY\" --draft=false");
    expect(workflow).not.toContain("releaseDraft: false");
  });

  test("Tauri release matrix builds each platform sidecar with an explicit Bun target", () => {
    const workflow = read(".github/workflows/release.yml");

    expect(workflow).toContain("Build Sidecar binary");
    expect(workflow).toContain("CYBARA_SIDECAR_BUN_TARGET: ${{ matrix.bun_target }}");
    expect(workflow).toContain("run: bun run scripts/build-sidecar.ts");
    expect(workflow).toContain("Sign Tauri sidecar runtime resources (macOS)");
    expect(workflow).toContain("run: bun run scripts/codesign-tauri-sidecar-runtime.ts");
    expect(workflow).toContain("bun_target: bun-darwin-arm64");
    expect(workflow).toContain('sidecar: "src-tauri/bin/cybara-aarch64-apple-darwin"');
    expect(workflow).toContain("bun_target: bun-darwin-x64");
    expect(workflow).toContain('sidecar: "src-tauri/bin/cybara-x86_64-apple-darwin"');
    expect(workflow).toContain("bun_target: bun-windows-x64");
    expect(workflow).toContain('sidecar: "src-tauri/bin/cybara-x86_64-pc-windows-msvc.exe"');
    expect(workflow).toContain("bun_target: bun-linux-x64");
    expect(workflow).toContain('sidecar: "src-tauri/bin/cybara-x86_64-unknown-linux-gnu"');
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
        newArchEnabled?: boolean;
        ios?: { bundleIdentifier?: string };
        android?: { package?: string };
        extra?: { gatewayContract?: string };
      };
    };
    const mobilePkg = JSON.parse(read("apps/mobile/package.json")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    expect(appJson.expo?.name).toBe("Cybara");
    expect(appJson.expo?.slug).toBe("cybara-mobile");
    expect(appJson.expo?.scheme).toBe("cybara");
    expect(appJson.expo?.newArchEnabled).toBe(true);
    expect(appJson.expo?.ios?.bundleIdentifier).toBe("com.ck.cybara");
    expect(appJson.expo?.android?.package).toBe("com.ck.cybara");
    expect(appJson.expo?.extra?.gatewayContract).toBe("cybara-mobile-connect-v1");

    expect(mobilePkg.scripts?.ios).toBe("bunx expo start --ios");
    expect(mobilePkg.scripts?.android).toBe("bunx expo start --android");
    expect(mobilePkg.scripts?.typecheck).toBe("bunx tsc --noEmit");
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
