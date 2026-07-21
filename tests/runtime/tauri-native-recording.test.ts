import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("Tauri native microphone recording", () => {
  test("registers the native recorder and confines recording reads", () => {
    const cargo = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
    const capabilities = readFileSync(
      join(root, "src-tauri", "capabilities", "default.json"),
      "utf8"
    );
    const permissions = readFileSync(
      join(root, "src-tauri", "permissions", "native-recording.toml"),
      "utf8"
    );
    const info = readFileSync(join(root, "src-tauri", "Info.plist"), "utf8");
    const entitlements = readFileSync(join(root, "src-tauri", "entitlements.plist"), "utf8");
    const releaseWorkflow = readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8");
    const main = readFileSync(join(root, "src-tauri", "src", "main.rs"), "utf8");

    expect(cargo).toContain('tauri-plugin-audio-recorder = "0.1.2"');
    expect(cargo).toContain('objc2-av-foundation = { version = "0.3.2"');
    expect(capabilities).toContain('"http://127.0.0.1:4269/*"');
    expect(capabilities).toContain('"http://localhost:4269/*"');
    expect(capabilities).toContain('"native-recording"');
    expect(permissions).toContain(
      'commands.allow = ["start_native_recording", "stop_native_recording"]'
    );
    expect(main).toContain("tauri_plugin_audio_recorder::init()");
    expect(main).toContain("async fn start_native_recording(app: tauri::AppHandle)");
    expect(main).toContain("async fn stop_native_recording(app: tauri::AppHandle)");
    expect(main).toContain("AVCaptureDevice::authorizationStatusForMediaType");
    expect(main).toContain("AVCaptureDevice::requestAccessForMediaType_completionHandler");
    expect(main).toContain("System Settings > Privacy & Security > Microphone");
    expect(main).toContain("tauri::async_runtime::spawn_blocking(move ||");
    expect(main).toContain("recording.starts_with(&temp)");
    expect(main).toContain('file_name.starts_with("recording-")');
    expect(main).toContain("MAX_NATIVE_RECORDING_BYTES");
    expect(main).toContain("std::fs::remove_file(&recording)");
    expect(main).toContain("fn gateway_endpoint(app: &tauri::AppHandle)");
    expect(main).toContain("gateway::GatewayEndpoint::loopback(CYBARA_DEFAULT_PORT)");
    expect(main).not.toContain('const CYBARA_SERVER_URL: &str = "http://127.0.0.1:4269"');
    expect(info).toContain("NSMicrophoneUsageDescription");
    expect(entitlements).toContain("com.apple.security.device.audio-input");
    expect(releaseWorkflow).toContain("libasound2-dev");
  });
});
