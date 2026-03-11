import { describe, expect, test } from "bun:test";
import {
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
      "Cybara-native-macos-arm64-1.2.3"
    );
    expect(getNativeMacOSArtifactBaseName("1.2.3", "x86_64")).toBe(
      "Cybara-native-macos-x86_64-1.2.3"
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
});
