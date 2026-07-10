import { describe, expect, test } from "bun:test";
import {
  parseTerminalInput,
  resolveTerminalLaunch,
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

  test("does not pass PowerShell flags to an explicit non-PowerShell shell", () => {
    const argv = resolveWindowsShellArgv(
      { CYBARA_TERMINAL_SHELL: "C:\\Windows\\System32\\cmd.exe" },
      (value) => (value === "C:\\Windows\\System32\\cmd.exe" ? value : null)
    );

    expect(argv).toEqual(["C:\\Windows\\System32\\cmd.exe"]);
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

  test("launches Unix shells directly without Python", () => {
    expect(resolveTerminalLaunch("linux", { SHELL: "/bin/bash" }, () => null)).toEqual({
      argv: ["/bin/bash", "-l"],
    });
  });

  test("preserves interactive xterm input while extracting resize frames", () => {
    const input = `abc${String.fromCharCode(127)}${String.fromCharCode(27)}[D${String.fromCharCode(3)}\r${String.fromCharCode(27)}[RESIZE:132,44]`;
    const parsed = parseTerminalInput(input);

    expect(parsed.payload).toBe(
      `abc${String.fromCharCode(127)}${String.fromCharCode(27)}[D${String.fromCharCode(3)}\r`
    );
    expect(parsed.resizes).toEqual([{ cols: 132, rows: 44 }]);
  });

  test("rejects invalid resize frames and bounds oversized terminals", () => {
    const escape = String.fromCharCode(27);
    expect(parseTerminalInput(`${escape}[RESIZE:0,30]`)).toEqual({ payload: "", resizes: [] });
    expect(parseTerminalInput(`${escape}[RESIZE:5000,3000]`).resizes).toEqual([
      { cols: 1000, rows: 1000 },
    ]);
  });
});
