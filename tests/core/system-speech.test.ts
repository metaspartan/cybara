import { describe, expect, test } from "bun:test";
import {
  buildSystemSpeechCommand,
  detectSystemSpeechCapability,
} from "../../src/core/system-speech";

function resolver(entries: Record<string, string>): (command: string) => string | null {
  return (command) => entries[command] || null;
}

describe("system speech capability", () => {
  test("detects the native engine for each supported desktop platform", () => {
    expect(detectSystemSpeechCapability("darwin", resolver({ say: "/usr/bin/say" }))).toMatchObject(
      {
        available: true,
        engine: "say",
        label: "macOS system voice",
      }
    );
    expect(
      detectSystemSpeechCapability(
        "win32",
        resolver({ "powershell.exe": "C:\\Windows\\System32\\WindowsPowerShell\\powershell.exe" })
      )
    ).toMatchObject({ available: true, engine: "sapi", label: "Windows system voice" });
    expect(
      detectSystemSpeechCapability("linux", resolver({ "espeak-ng": "/usr/bin/espeak-ng" }))
    ).toMatchObject({ available: true, engine: "espeak-ng", label: "Linux system voice" });
  });

  test("reports actionable unavailable states", () => {
    expect(detectSystemSpeechCapability("win32", resolver({}))).toMatchObject({
      available: false,
      error: "Windows speech synthesis is unavailable.",
    });
    expect(detectSystemSpeechCapability("linux", resolver({}))).toMatchObject({
      available: false,
      error: "Install espeak-ng or espeak to use the system voice.",
    });
  });
});

describe("system speech commands", () => {
  test("builds a macOS say command without shell interpolation", () => {
    const capability = detectSystemSpeechCapability("darwin", resolver({ say: "/usr/bin/say" }));
    expect(
      buildSystemSpeechCommand(capability, {
        text: "hello; $(touch /tmp/nope)",
        outputPath: "/tmp/cybara.aiff",
        voice: "Samantha",
        speed: 1.2,
      })
    ).toEqual([
      "/usr/bin/say",
      "-v",
      "Samantha",
      "-r",
      "210",
      "-o",
      "/tmp/cybara.aiff",
      "--",
      "hello; $(touch /tmp/nope)",
    ]);
  });

  test("builds an escaped Windows SAPI command", () => {
    const capability = detectSystemSpeechCapability(
      "win32",
      resolver({ "powershell.exe": "powershell.exe" })
    );
    const command = buildSystemSpeechCommand(capability, {
      text: "Carsen's voice",
      outputPath: "C:\\Temp\\cybara.wav",
      voice: "Microsoft Zira Desktop",
      speed: 1.5,
    });
    expect(command.slice(0, 5)).toEqual([
      "powershell.exe",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
    ]);
    expect(command[5]).toContain("Carsen''s voice");
    expect(command[5]).toContain("C:\\Temp\\cybara.wav");
    expect(command[5]).toContain("SelectVoice('Microsoft Zira Desktop')");
  });

  test("builds a Linux espeak command", () => {
    const capability = detectSystemSpeechCapability(
      "linux",
      resolver({ "espeak-ng": "/usr/bin/espeak-ng" })
    );
    expect(
      buildSystemSpeechCommand(capability, {
        text: "hello",
        outputPath: "/tmp/cybara.wav",
        voice: "en-us",
        rate: 200,
      })
    ).toEqual([
      "/usr/bin/espeak-ng",
      "-w",
      "/tmp/cybara.wav",
      "-v",
      "en-us",
      "-s",
      "200",
      "--",
      "hello",
    ]);
  });
});
