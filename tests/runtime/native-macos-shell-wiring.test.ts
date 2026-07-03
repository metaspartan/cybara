import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MACOS_APP_DIR = join(ROOT_DIR, "apps", "macos", "Cybara", "Sources", "Cybara");

describe("native macOS shell wiring", () => {
  test("sidecar manager reuses gateway port 4269 and configures a managed local launch", () => {
    const sidecarManager = readFileSync(join(MACOS_APP_DIR, "SidecarManager.swift"), "utf8");
    const sidecarCore = readFileSync(join(MACOS_APP_DIR, "SidecarCore.swift"), "utf8");

    expect(sidecarManager).toContain("CYBARA_NATIVE_PORT");
    expect(sidecarManager).toContain("SidecarCore.port(fromEnv:");
    expect(sidecarCore).toContain("public static let defaultPort = 4269");
    expect(sidecarManager).toContain("Attached to existing Cybara gateway");
    expect(sidecarCore).toContain('environment["PORT"] = String(port)');
    expect(sidecarCore).toContain('environment["CYBARA_HOST"] = "127.0.0.1"');
    expect(sidecarManager).toContain('arguments = ["start", "--enable-terminal"]');
    expect(sidecarCore).toContain("ancestorDirectories(from: currentDirectory)");
    expect(sidecarCore).toContain("ancestorDirectories(from: executableDirectory)");
    expect(sidecarCore).toContain('bundledSidecar.appendingPathComponent("cybara").path');
    expect(sidecarManager).toContain("gatewayMode = .managed");
    expect(sidecarManager).toContain("gatewayMode = .attached");
  });

  test("webview injects the cybara native runtime bridge and notification support", () => {
    const webView = readFileSync(join(MACOS_APP_DIR, "CybaraWebView.swift"), "utf8");

    expect(webView).toContain("__CYBARA_NATIVE__");
    expect(webView).toContain('runtime: "cybara-native"');
    expect(webView).toContain("requestNotificationPermission");
    expect(webView).toContain("notificationPermission");
    expect(webView).toContain("openDirectoryDialog");
    expect(webView).toContain("NSOpenPanel");
    expect(webView).toContain("UNUserNotificationCenter");
    expect(webView).toContain('document.documentElement.dataset.runtime = "cybara-native"');
  });

  test("gateway model labels trim blank titles before falling back", () => {
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");
    const modelTests = readFileSync(
      join(
        ROOT_DIR,
        "apps",
        "macos",
        "Cybara",
        "Tests",
        "CybaraTests",
        "GatewayClientModelTests.swift"
      ),
      "utf8"
    );

    expect(gatewayModels).toContain("func firstNonEmptyGatewayString");
    expect(gatewayModels).toContain(
      "var displayTitle: String { firstNonEmptyGatewayString(title) ?? String(id.prefix(8)) }"
    );
    expect(gatewayModels).toContain(
      "var displayName: String { firstNonEmptyGatewayString(name, provider, id) ?? id }"
    );
    expect(gatewayModels).toContain(
      "var displayName: String { firstNonEmptyGatewayString(name, type, id) ?? id }"
    );
    expect(modelTests).toContain("testSessionDisplayTitleFallsBackForBlankOrMissingTitle");
    expect(modelTests).toContain("testProviderDisplayNamePrefersFirstNonEmptyGatewayLabel");
    expect(modelTests).toContain("testChannelDisplayNamePrefersFirstNonEmptyGatewayLabel");
  });

  test("native chat requests complete tool call payloads for transcripts", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");
    const toolTimeline = readFileSync(join(MACOS_APP_DIR, "NativeToolTimeline.swift"), "utf8");
    const nativeScreens = readFileSync(join(MACOS_APP_DIR, "NativeScreens.swift"), "utf8");

    expect(gatewayClient).toContain('URLQueryItem(name: "includeFullToolCalls", value: "1")');
    expect(gatewayModels).toContain("let tool_calls: [GatewayToolCall]?");
    expect(gatewayModels).toContain("let process_activities: [GatewayProcessActivity]?");
    expect(toolTimeline).toContain("func nativeOrderedToolCalls");
    expect(toolTimeline).toContain("func nativeToolActivities");
    expect(nativeScreens).toContain("NativeToolTimelineView(message: message)");
  });

  test("native memory screen uses gateway CRUD/search routes with encoded filenames", () => {
    const gatewayClient = readFileSync(join(MACOS_APP_DIR, "GatewayClient.swift"), "utf8");
    const gatewayModels = readFileSync(join(MACOS_APP_DIR, "GatewayModels.swift"), "utf8");
    const configScreens = readFileSync(join(MACOS_APP_DIR, "NativeConfigScreens.swift"), "utf8");
    const modelTests = readFileSync(
      join(
        ROOT_DIR,
        "apps",
        "macos",
        "Cybara",
        "Tests",
        "CybaraTests",
        "GatewayClientModelTests.swift"
      ),
      "utf8"
    );

    expect(gatewayClient).toContain("private func pathSegment");
    expect(gatewayClient).toContain('allowed.remove(charactersIn: "/")');
    expect(gatewayClient).toContain('try await get("api/memory", as: GatewayMemoryList.self)');
    expect(gatewayClient).toContain('"api/memory/search"');
    expect(gatewayClient).toContain("GatewayMemorySearchResponse.self");
    expect(gatewayClient).toContain('"api/memory/\\(pathSegment(file))"');
    expect(gatewayClient).toContain('method: "PUT"');
    expect(gatewayClient).toContain('method: "DELETE"');

    expect(gatewayModels).toContain("struct GatewayMemoryEntry");
    expect(gatewayModels).toContain("struct GatewayMemoryList");
    expect(gatewayModels).toContain("struct GatewayMemorySearchResponse");
    expect(gatewayModels).toContain("struct GatewayMemoryCreateResponse");

    expect(configScreens).toContain('TextField("Search memory"');
    expect(configScreens).toContain('Button(saving ? "Saving..." : "Add Entry")');
    expect(configScreens).toContain("editingEntry = MemoryEditDraft");
    expect(configScreens).toContain("client.updateMemory(file: draft.file, index: draft.index");
    expect(configScreens).toContain("client.deleteMemory(file: file, index: index)");
    expect(configScreens).toContain("MemoryEditSheet");

    expect(modelTests).toContain("testMemoryListDecodesFilesAndEntries");
    expect(modelTests).toContain("testMemorySearchResponseDecodesGatewayResults");
    expect(modelTests).toContain("testMemoryCreateResponseDecodesGatewaySuccessShape");
  });
});
