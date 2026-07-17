import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NATIVE_DIR = join(ROOT_DIR, "apps", "macos", "Cybara", "Sources", "Cybara");
const NATIVE_TEST_DIR = join(ROOT_DIR, "apps", "macos", "Cybara", "Tests", "CybaraTests");

function readBundle(baseDir: string, files: readonly string[]): string {
  return files.map((file) => readFileSync(join(baseDir, file), "utf8")).join("\n");
}

export function readUiStylesSource(): string {
  return readBundle(join(ROOT_DIR, "ui", "src"), [
    "index.css",
    "styles/index-foundation.css",
    "styles/index-light.css",
    "styles/index-themes.css",
  ]);
}

export function readNativeChatSource(): string {
  return readBundle(NATIVE_DIR, [
    "NativeScreens.swift",
    "NativeChatAppearance.swift",
    "NativeChatComposer.swift",
    "NativeChatDerivedState.swift",
    "NativeChatEnvironment.swift",
    "NativeChatRuntimeActions.swift",
    "NativeChatSidebar.swift",
    "NativeChatSupport.swift",
    "NativeChatTimeline.swift",
    "NativeChatTranscript.swift",
    "NativeChatWorkspaceActions.swift",
    "NativeChatWorkspacePanel.swift",
  ]);
}

export function readNativeSettingsSource(): string {
  return readBundle(NATIVE_DIR, [
    "NativeSettingsScreen.swift",
    "SettingsView.swift",
    "NativeSettingsActions.swift",
    "NativeSettingsAdvancedSections.swift",
    "NativeSettingsFeatureSections.swift",
    "NativeSettingsGeneralSections.swift",
    "NativeSettingsMemoryMigrationSections.swift",
    "NativeSettingsModelSpeechSections.swift",
    "NativeNearbySettingsSection.swift",
    "NativeTelemetrySettingsScreen.swift",
    "NativeToolCapabilitySettingsScreen.swift",
  ]);
}

export function readNativePlatformSource(): string {
  return readBundle(NATIVE_DIR, [
    "NativePlatformModels.swift",
    "NativePlatformGatewayClient.swift",
    "NativePlatformViewSupport.swift",
    "NativePluginsScreen.swift",
    "NativeMCPScreen.swift",
    "NativeLSPScreen.swift",
    "NativeIDEScreen.swift",
    "NativeSessionsManagementScreen.swift",
    "NativeToolsScreen.swift",
    "NativeTerminalScreen.swift",
    "NativeArtifactsScreen.swift",
  ]);
}

export function readNativeConfigSource(): string {
  return readBundle(NATIVE_DIR, [
    "NativeRouterScreen.swift",
    "NativeSystemPromptScreen.swift",
    "NativeMemoryScreen.swift",
    "NativeChannelsScreen.swift",
    "NativeLogsScreen.swift",
    "NativeWalletScreen.swift",
  ]);
}

export function readGatewayModelsSource(): string {
  return readBundle(NATIVE_DIR, [
    "GatewayChatModels.swift",
    "GatewayChannelModels.swift",
    "GatewayRoutingModels.swift",
    "GatewayMetricsModels.swift",
  ]);
}

export function readGatewayModelTestsSource(): string {
  return readBundle(NATIVE_TEST_DIR, [
    "GatewayClientModelTests.swift",
    "GatewayRuntimeModelTests.swift",
    "GatewayModelTestSupport.swift",
  ]);
}
