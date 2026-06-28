import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("Tauri wiring", () => {
  test("tauri.conf.json includes Cybara sidecar + bundled UI assets", () => {
    const confPath = join(ROOT_DIR, "src-tauri", "tauri.conf.json");
    const conf = JSON.parse(readFileSync(confPath, "utf8")) as {
      build?: { frontendDist?: string; beforeDevCommand?: string };
      bundle?: { resources?: string[]; externalBin?: string[] };
    };

    expect(conf.build?.frontendDist).toBe("../ui/dist");
    expect(conf.build?.beforeDevCommand).toContain("bun run dev");
    expect(conf.bundle?.resources).toContain("../ui/dist/**/*");
    expect(conf.bundle?.externalBin).toContain("bin/cybara");
  });

  test("main.rs starts and stops the cybara sidecar process", () => {
    const mainRsPath = join(ROOT_DIR, "src-tauri", "src", "main.rs");
    const mainRs = readFileSync(mainRsPath, "utf8");

    expect(mainRs).toContain("sidecar(\"cybara\")");
    expect(mainRs).toContain(".args([\"start\", \"--enable-terminal\"])");
    expect(mainRs).toContain('const CYBARA_SERVER_URL: &str = "http://127.0.0.1:4269"');
    expect(mainRs).toContain("window.navigate(CYBARA_SERVER_URL.parse().unwrap())");
    expect(mainRs).toContain('.env("CYBARA_HOST", "127.0.0.1")');
    expect(mainRs).toContain("child.kill()");
  });

  test("main.rs preserves sidecar lifecycle and verifies existing server identity", () => {
    const mainRsPath = join(ROOT_DIR, "src-tauri", "src", "main.rs");
    const mainRs = readFileSync(mainRsPath, "utf8");

    expect(mainRs).toContain("if is_server_running()");
    expect(mainRs).toContain("GET /api/health HTTP/1.1");
    expect(mainRs).toContain('\\"status\\":\\"healthy\\"');
    expect(mainRs).toContain("Server already running on port 4269");
    expect(mainRs).toContain("SidecarState(std::sync::Mutex::new(None))");
    expect(mainRs).toContain("*guard = Some(child)");
    expect(mainRs).toContain("wait_for_server_ready(Duration::from_secs(25))");
    expect(mainRs).toContain("if let tauri::WindowEvent::CloseRequested");
    expect(mainRs).toContain("if let Some(state) = app.try_state::<SidecarState>()");
    expect(mainRs).toContain("if let Some(child) = guard.take()");
  });

  test("desktop capability narrows webview origins and shell permissions", () => {
    const capabilityPath = join(ROOT_DIR, "src-tauri", "capabilities", "default.json");
    const capability = JSON.parse(readFileSync(capabilityPath, "utf8")) as {
      remote?: { urls?: string[] };
      permissions?: string[];
    };
    const tauriConfig = readFileSync(join(ROOT_DIR, "src-tauri", "tauri.conf.json"), "utf8");

    expect(capability.remote?.urls).toContain("http://127.0.0.1:4269");
    expect(capability.remote?.urls).toContain("http://localhost:5173");
    expect(capability.remote?.urls).not.toContain("http://localhost:*");
    expect(capability.permissions).not.toContain("shell:allow-spawn");
    expect(capability.permissions).not.toContain("shell:allow-execute");
    expect(tauriConfig).toContain('"csp": "default-src');
  });
});
