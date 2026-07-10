import { describe, expect, test } from "bun:test";
import {
  resolveTerminalLaunch,
  resolveUnixPtyCommand,
  resolveWindowsShellArgv,
} from "../../src/api/terminal";

describe("cross-platform terminal shell selection", () => {
  test("prefers an explicit Windows terminal shell", () => {
    const argv = resolveWindowsShellArgv(
      { CYBARA_TERMINAL_SHELL: "C:\\Tools\\pwsh.exe" },
      (value) => (value === "C:\\Tools\\pwsh.exe" ? value : null)
    );

    expect(argv).toEqual(["C:\\Tools\\pwsh.exe", "-NoLogo", "-NoProfile"]);
  });

  test("prefers PowerShell 7 and suppresses profile startup work", () => {
    const argv = resolveWindowsShellArgv({}, (value) =>
      value === "pwsh" ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : null
    );

    expect(argv).toEqual(["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "-NoLogo", "-NoProfile"]);
  });

  test("falls back to a quiet cmd session when PowerShell is unavailable", () => {
    const argv = resolveWindowsShellArgv({ COMSPEC: "C:\\Windows\\System32\\cmd.exe" }, () => null);

    expect(argv).toEqual(["C:\\Windows\\System32\\cmd.exe", "/D", "/Q"]);
  });

  test("uses python when python3 is unavailable on Unix", () => {
    const command = resolveUnixPtyCommand((value) =>
      value === "python" ? "/usr/bin/python" : null
    );

    expect(command).toBe("/usr/bin/python");
  });

  test("does not require Python for Unix terminal startup", () => {
    expect(resolveUnixPtyCommand(() => null)).toBeNull();
    expect(resolveTerminalLaunch("linux", { SHELL: "/bin/bash" }, () => null)).toEqual({
      argv: ["/bin/bash", "-l"],
      mode: "pipe",
    });
  });
});
