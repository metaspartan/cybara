import { invoke } from "@tauri-apps/api/core";
import { isTauriDesktopRuntime } from "./desktopHost";

export type GatewayStartupPhase = "starting" | "ready" | "failed";

export interface GatewayStartupStatus {
  phase: GatewayStartupPhase;
  message: string | null;
}

export async function readGatewayStartupStatus(): Promise<GatewayStartupStatus | null> {
  if (!isTauriDesktopRuntime()) return null;
  try {
    return await invoke<GatewayStartupStatus>("get_gateway_startup_status");
  } catch {
    return null;
  }
}
