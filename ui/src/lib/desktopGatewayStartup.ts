import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktopRuntime } from "./desktopHost";

export type GatewayStartupPhase = "starting" | "ready" | "failed";

export interface GatewayStartupStatus {
  phase: GatewayStartupPhase;
  message: string | null;
}

export function gatewayStartupPollInterval(desktopRuntime: boolean): number | false {
  return desktopRuntime ? 1_000 : false;
}

export function isGatewayRecovering(status: GatewayStartupStatus | null | undefined): boolean {
  return status?.phase === "starting" && Boolean(status.message);
}

export async function readGatewayStartupStatus(): Promise<GatewayStartupStatus | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    return await invoke<GatewayStartupStatus>("get_gateway_startup_status");
  } catch {
    return null;
  }
}

export async function restartDesktopGateway(): Promise<boolean> {
  if (!isTauriDesktopRuntime()) return false;
  try {
    await invoke("restart_gateway_sidecar");
    return true;
  } catch {
    return false;
  }
}
