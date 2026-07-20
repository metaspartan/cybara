import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createNativeMacOSSidecarLayout,
  createNativeMacOSInfoPlist,
  findNestedSignables,
  getNativeMacOSArtifactBaseName,
  isMachOFile,
  resolveNativeMacOSArch,
  resolveNativeMacOSSigningIdentity,
  resolveNotaryPollSeconds,
  resolveNotaryTimeoutMinutes,
} from "../../scripts/package-native-macos";

describe("native macOS packaging helpers", () => {
  test("resolves supported macOS architectures", () => {
    expect(resolveNativeMacOSArch("arm64")).toBe("arm64");
    expect(resolveNativeMacOSArch("x64")).toBe("x86_64");
    expect(resolveNativeMacOSArch("x86_64")).toBe("x86_64");
    expect(() => resolveNativeMacOSArch("ia32")).toThrow("Unsupported macOS architecture");
  });

  test("builds stable native macOS artifact names", () => {
    expect(getNativeMacOSArtifactBaseName("1.2.3", "arm64")).toBe("CybaraNative-v1.2.3-arm64");
    expect(getNativeMacOSArtifactBaseName("1.2.3", "x86_64")).toBe("CybaraNative-v1.2.3-x86_64");
  });

  test("uses ad-hoc signing for locally packaged native apps", () => {
    expect(resolveNativeMacOSSigningIdentity(undefined)).toBe("-");
    expect(resolveNativeMacOSSigningIdentity("  ")).toBe("-");
    expect(resolveNativeMacOSSigningIdentity("Developer ID Application: Cybara")).toBe(
      "Developer ID Application: Cybara"
    );
  });

  test("generates an Info.plist with the expected production metadata", () => {
    const plist = createNativeMacOSInfoPlist("1.2.3");

    expect(plist).toContain("<string>Cybara Native</string>");
    expect(plist).toContain("<string>CybaraNative</string>");
    expect(plist).toContain("<string>com.cybara.native</string>");
    expect(plist).toContain("<string>AppIcon.icns</string>");
    expect(plist).toContain("<string>1.2.3</string>");
    expect(plist).toContain("<string>14.0</string>");
    expect(plist).toContain("<key>NSLocalNetworkUsageDescription</key>");
    expect(plist).toContain("<string>_cybara-nearby._tcp</string>");
  });

  test("keeps sidecar resources outside Contents/MacOS for codesigning", () => {
    const layout = createNativeMacOSSidecarLayout("/bundle/Cybara.app/Contents");

    expect(layout.executableDir).toBe("/bundle/Cybara.app/Contents/MacOS/sidecar");
    expect(layout.resourceDir).toBe("/bundle/Cybara.app/Contents/Resources/sidecar");
    expect(layout.onnxRuntimeDir).toBe("/bundle/Cybara.app/Contents/Resources/sidecar/onnxruntime");
    expect(layout.runtimeDir).toBe("/bundle/Cybara.app/Contents/Resources/sidecar/runtime");
    expect(layout.cuaDriverDir).toBe("/bundle/Cybara.app/Contents/Resources/sidecar/cua-driver");
    expect(layout.pluginsDir).toBe("/bundle/Cybara.app/Contents/Resources/sidecar/plugins");
    expect(layout.nodeModulesDir).toBe(
      "/bundle/Cybara.app/Contents/Resources/sidecar/node_modules"
    );
    expect(layout.uiDistDir).toBe("/bundle/Cybara.app/Contents/Resources/sidecar/ui/dist");
    expect(layout.wasmPath).toBe("/bundle/Cybara.app/Contents/Resources/sidecar/secp256k1.wasm");
  });

  test("verifies the bundled gateway version before packaging", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "..", "scripts", "package-native-macos.ts"),
      "utf8"
    );
    expect(source).toContain("await smokeSidecarUi(SIDEcar_RELEASE_PATH, version)");
  });

  test("detects extensionless Mach-O helper executables for nested signing", () => {
    const temp = mkdtempSync(join(tmpdir(), "cybara-native-signables-"));
    try {
      const contents = join(temp, "Cybara.app", "Contents");
      const helper = join(contents, "MacOS", "Helpers", "Renderer Helper");
      const addon = join(contents, "MacOS", "sidecar", "addon.node");
      const png = join(contents, "Resources", "sidecar", "cybara.png");

      mkdirSync(join(contents, "MacOS", "Helpers"), { recursive: true });
      mkdirSync(join(contents, "MacOS", "sidecar"), { recursive: true });
      mkdirSync(join(contents, "Resources", "sidecar"), { recursive: true });

      writeFileSync(helper, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00, 0x00, 0x00, 0x00]));
      writeFileSync(addon, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00, 0x00, 0x00, 0x00]));
      writeFileSync(png, "not a mach-o");
      chmodSync(helper, 0o755);
      chmodSync(addon, 0o644);
      chmodSync(png, 0o755);

      expect(isMachOFile(helper)).toBe(true);
      expect(isMachOFile(png)).toBe(false);
      expect(findNestedSignables(contents)).toEqual([helper, addon]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test("uses bounded defaults for native notarization polling", () => {
    expect(resolveNotaryTimeoutMinutes(undefined)).toBe(90);
    expect(resolveNotaryTimeoutMinutes("120")).toBe(120);
    expect(resolveNotaryTimeoutMinutes("0")).toBe(90);
    expect(resolveNotaryPollSeconds(undefined)).toBe(30);
    expect(resolveNotaryPollSeconds("45")).toBe(45);
    expect(resolveNotaryPollSeconds("5")).toBe(30);
  });
});
