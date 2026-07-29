export type SubprocessSignal = Parameters<Bun.Subprocess["kill"]>[0];

export function killSubprocessTree(
  processHandle: Bun.Subprocess,
  signal: SubprocessSignal = "SIGTERM"
): void {
  if (process.platform === "win32") {
    try {
      Bun.spawn(["taskkill", "/pid", String(processHandle.pid), "/t", "/f"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      return;
    } catch {
      void 0;
    }
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-processHandle.pid, signal);
      return;
    } catch {
      void 0;
    }
  }

  try {
    processHandle.kill(signal);
  } catch {
    void 0;
  }
}
