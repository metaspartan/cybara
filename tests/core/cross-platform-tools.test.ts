import { describe, expect, test } from "bun:test";
import { zipExtractionCommands } from "../../src/core/archive";
import { shellEscapeArg } from "../../src/core/platform";
import { resolveClipboardCommands } from "../../src/core/tools/handlers/clipboard";

describe("shellEscapeArg", () => {
  test("passes safe tokens through unchanged", () => {
    expect(shellEscapeArg("status", "linux")).toBe("status");
    expect(shellEscapeArg("--oneline", "win32")).toBe("--oneline");
  });

  test("POSIX quoting survives embedded single quotes", () => {
    expect(shellEscapeArg("it's done", "darwin")).toBe("'it'\"'\"'s done'");
    expect(shellEscapeArg("msg with spaces", "linux")).toBe("'msg with spaces'");
  });

  test("Windows quoting doubles single quotes for PowerShell", () => {
    expect(shellEscapeArg("msg with spaces", "win32")).toBe("'msg with spaces'");
    expect(shellEscapeArg("it's done", "win32")).toBe("'it''s done'");
    expect(shellEscapeArg("it's done", "win32")).not.toContain("'\"'\"'");
  });
});

describe("zipExtractionCommands", () => {
  test("Windows uses bsdtar with Expand-Archive fallback", () => {
    const commands = zipExtractionCommands("C:\\a.zip", "C:\\out", "win32", () => false);
    expect(commands[0][0]).toBe("tar");
    expect(commands[1][0]).toBe("powershell.exe");
    expect(commands[1].join(" ")).toContain("Expand-Archive");
  });

  test("macOS prefers unzip then tar", () => {
    const commands = zipExtractionCommands("/a.zip", "/out", "darwin", () => true);
    expect(commands.map((command) => command[0])).toEqual(["unzip", "tar"]);
  });

  test("Linux without unzip falls back to bsdtar when available", () => {
    const commands = zipExtractionCommands("/a.zip", "/out", "linux", (cmd) => cmd === "bsdtar");
    expect(commands[0][0]).toBe("bsdtar");
  });
});

describe("resolveClipboardCommands", () => {
  test("macOS uses pbpaste/pbcopy", () => {
    const commands = resolveClipboardCommands("darwin", () => false);
    expect(commands.read[0]).toBe("pbpaste");
    expect(commands.write[0]).toBe("pbcopy");
  });

  test("Windows uses PowerShell Get/Set-Clipboard", () => {
    const commands = resolveClipboardCommands("win32", () => false);
    expect(commands.read.join(" ")).toContain("Get-Clipboard");
    expect(commands.write.join(" ")).toContain("Set-Clipboard");
  });

  test("Linux prefers wl-clipboard, then xclip, then xsel", () => {
    const wayland = resolveClipboardCommands("linux", (cmd) => cmd.startsWith("wl-"));
    expect(wayland.read[0]).toBe("wl-paste");
    const x11 = resolveClipboardCommands("linux", (cmd) => cmd === "xclip");
    expect(x11.read[0]).toBe("xclip");
    const xsel = resolveClipboardCommands("linux", (cmd) => cmd === "xsel");
    expect(xsel.write[0]).toBe("xsel");
    expect(() => resolveClipboardCommands("linux", () => false)).toThrow("clipboard utility");
  });
});
