import { describe, expect, test } from "bun:test";
import {
  createNativeMacOSSidecarLayout,
  createNativeMacOSInfoPlist,
  getNativeMacOSArtifactBaseName,
  resolveNativeMacOSArch,
} from "../../scripts/package-native-macos";

describe("native macOS packaging helpers", () => {
  test("resolves supported macOS architectures", () => {
    expect(resolveNativeMacOSArch("arm64")).toBe("arm64");
    expect(resolveNativeMacOSArch("x64")).toBe("x86_64");
    expect(resolveNativeMacOSArch("x86_64")).toBe("x86_64");
    expect(() => resolveNativeMacOSArch("ia32")).toThrow("Unsupported macOS architecture");
  });

  test("builds stable native macOS artifact names", () => {
    expect(getNativeMacOSArtifactBaseName("1.2.3", "arm64")).toBe(
      "Cybara-v1.2.3-Swift-Native-Desktop-arm64"
    );
    expect(getNativeMacOSArtifactBaseName("1.2.3", "x86_64")).toBe(
      "Cybara-v1.2.3-Swift-Native-Desktop-x86_64"
    );
  });

  test("generates an Info.plist with the expected production metadata", () => {
    const plist = createNativeMacOSInfoPlist("1.2.3");

    expect(plist).toContain("<string>Cybara</string>");
    expect(plist).toContain("<string>com.cybara.native</string>");
    expect(plist).toContain("<string>AppIcon.icns</string>");
    expect(plist).toContain("<string>1.2.3</string>");
    expect(plist).toContain("<string>14.0</string>");
  });

  test("keeps sidecar resources outside Contents/MacOS for codesigning", () => {
    const layout = createNativeMacOSSidecarLayout("/bundle/Cybara.app/Contents");

    expect(layout.executableDir).toBe("/bundle/Cybara.app/Contents/MacOS/sidecar");
    expect(layout.onnxRuntimeDir).toBe("/bundle/Cybara.app/Contents/MacOS/sidecar/onnxruntime");
    expect(layout.resourceDir).toBe("/bundle/Cybara.app/Contents/Resources/sidecar");
    expect(layout.uiDistDir).toBe("/bundle/Cybara.app/Contents/Resources/sidecar/ui/dist");
    expect(layout.wasmPath).toBe("/bundle/Cybara.app/Contents/Resources/sidecar/secp256k1.wasm");
  });
});
