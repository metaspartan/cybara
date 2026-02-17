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
    expect(mainRs).toContain(".args([\"start\"])");
    expect(mainRs).toContain("window.navigate(\"http://localhost:4269\"");
    expect(mainRs).toContain("child.kill()");
  });
});
