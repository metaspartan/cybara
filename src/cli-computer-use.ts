type FetchAPI = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

interface ComputerUseStatus {
  available: boolean;
  command: string;
  driverSource?: "env" | "config" | "path" | "known-install-dir" | "default";
  configuredCommand?: string;
  platform: string;
  version?: string;
  accessibility?: boolean;
  screenRecording?: boolean;
  ready: boolean;
  message: string;
}

function printComputerUseStatus(status: ComputerUseStatus): void {
  const yn = (value?: boolean) => (value === undefined ? "n/a" : value ? "yes" : "NO");
  console.log("Computer Use (cua-driver)");
  console.log(`  command:          ${status.command}`);
  if (status.driverSource) console.log(`  source:           ${status.driverSource}`);
  if (status.configuredCommand) console.log(`  configured path:  ${status.configuredCommand}`);
  console.log(`  installed:        ${yn(status.available)}${status.version ? ` (${status.version})` : ""}`);
  console.log(`  platform:         ${status.platform}`);
  if (status.platform === "darwin") {
    console.log(`  accessibility:    ${yn(status.accessibility)}`);
    console.log(`  screen recording: ${yn(status.screenRecording)}`);
  }
  console.log(`  ready:            ${status.ready ? "yes" : "NO"}`);
  console.log(`  ${status.message}`);
}

export async function rawComputerUse(
  args: string[],
  fetchAPI: FetchAPI,
  apiBase: string
): Promise<void> {
  const sub = (args[1] || "status").toLowerCase();

  if (sub === "setup" || sub === "grant") {
    const grant = await fetchAPI<{ ok: boolean; message: string }>(
      "/api/computer-use/permissions/grant",
      { method: "POST" }
    );
    if (grant) console.log(grant.message);
  }

  const status = await fetchAPI<ComputerUseStatus>("/api/computer-use/status");
  if (!status) {
    console.error("ERROR: Failed to query computer-use status from", apiBase);
    process.exit(1);
  }
  printComputerUseStatus(status);
  if (!status.ready) process.exitCode = 1;
}
