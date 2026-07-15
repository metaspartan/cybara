import { describe, expect, test } from "bun:test";
import { nativeFolderDialogCommand } from "../../src/core/native-folder-dialog";

describe("native folder dialog", () => {
  test("builds a host-native folder chooser without shell interpolation", () => {
    const command = nativeFolderDialogCommand(
      {
        defaultPath: "/tmp/workspace'; touch /tmp/unsafe",
        title: "Select workspace'; exit",
      },
      {
        platform: "darwin",
      }
    );

    expect(command).not.toBeNull();
    expect(command?.argv[0]).toBe("osascript");
    expect(command?.argv[2]).not.toContain("touch /tmp/unsafe");
    expect(command?.argv.at(-1)).toBe("/tmp/workspace'; touch /tmp/unsafe");
  });

  test("removes null bytes from native dialog values", () => {
    const command = nativeFolderDialogCommand(
      {
        defaultPath: "/tmp/work\0space",
        title: "Choose\0 workspace",
      },
      {
        platform: "darwin",
      }
    );

    expect(command).not.toBeNull();
    expect(JSON.stringify(command)).not.toContain("\\u0000");
  });

  test("uses environment variables for Windows dialog values", () => {
    const command = nativeFolderDialogCommand(
      { defaultPath: "C:\\Users\\Carsen\\repo", title: "Select workspace" },
      { commandAvailable: (name) => name === "powershell.exe", platform: "win32" }
    );

    expect(command?.argv[0]).toBe("powershell.exe");
    expect(command?.argv).toContain("-STA");
    expect(command?.env).toEqual({
      CYBARA_FOLDER_DIALOG_PATH: "C:\\Users\\Carsen\\repo",
      CYBARA_FOLDER_DIALOG_TITLE: "Select workspace",
    });
  });

  test("prefers a native Linux chooser and reports unavailable hosts", () => {
    const zenity = nativeFolderDialogCommand(
      { defaultPath: "/home/carsen/repo", title: "Select workspace" },
      { commandAvailable: (name) => name === "zenity", platform: "linux" }
    );
    const unavailable = nativeFolderDialogCommand(
      {},
      { commandAvailable: () => false, platform: "linux" }
    );

    expect(zenity?.argv).toContain("--directory");
    expect(zenity?.argv).toContain("--filename=/home/carsen/repo/");
    expect(unavailable).toBeNull();
  });
});
