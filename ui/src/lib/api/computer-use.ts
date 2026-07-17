import { fetchApi } from "@/lib/api-client";

export interface ComputerUseStatus {
  available: boolean;
  command: string;
  driverSource?:
    | "env"
    | "config"
    | "bundled"
    | "managed-runtime"
    | "path"
    | "known-install-dir"
    | "default";
  configuredCommand?: string;
  platform: string;
  version?: string;
  accessibility?: boolean;
  screenRecording?: boolean;
  ready: boolean;
  message: string;
  installHint?: string;
  searchedPaths?: string[];
}

export interface ComputerUseTrajectorySummary {
  id: string;
  sessionId: string;
  status: "recording" | "completed" | "interrupted" | "error";
  recordVideo: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  replayOf?: string;
  turnCount: number;
  screenshotCount: number;
  clickCount: number;
  durationMs: number;
  videoAvailable: boolean;
}

export interface ComputerUseTrajectoryTurn {
  index: number;
  tool: string;
  arguments: Record<string, unknown>;
  result: unknown;
  pid?: number;
  clickPoint?: { x: number; y: number };
  timestamp?: string;
  hasScreenshot: boolean;
  hasClickImage: boolean;
  hasAppState: boolean;
}

export interface ComputerUseTrajectoryDetail extends ComputerUseTrajectorySummary {
  turns: ComputerUseTrajectoryTurn[];
}

export interface ComputerUseTrajectorySettings {
  driverCommand: string;
  trajectoryCaptureEnabled: boolean;
  trajectoryVideoEnabled: boolean;
}

export const computerUseApi = {
  getStatus: () => fetchApi<ComputerUseStatus>("/computer-use/status"),
  grantPermissions: () =>
    fetchApi<{ ok: boolean; message: string }>("/computer-use/permissions/grant", {
      method: "POST",
    }),
  trajectories: () =>
    fetchApi<{
      trajectories: ComputerUseTrajectorySummary[];
      activeId: string | null;
      settings: ComputerUseTrajectorySettings;
    }>("/computer-use/trajectories"),
  trajectory: (id: string) =>
    fetchApi<{
      success: boolean;
      trajectory?: ComputerUseTrajectoryDetail;
      error?: string;
    }>(`/computer-use/trajectories/${encodeURIComponent(id)}`),
  configureTrajectories: (settings: {
    trajectoryCaptureEnabled?: boolean;
    trajectoryVideoEnabled?: boolean;
  }) =>
    fetchApi<{ success: boolean; settings: ComputerUseTrajectorySettings }>(
      "/computer-use/trajectories/config",
      { method: "POST", body: JSON.stringify(settings) }
    ),
  exportTrajectories: (ids: string[], includeMedia: boolean, redact: boolean) => {
    const params = new URLSearchParams({
      includeMedia: includeMedia ? "1" : "0",
      redact: redact ? "1" : "0",
    });
    if (ids.length > 0) params.set("ids", ids.join(","));
    return fetchApi<{
      filename: string;
      mimeType: string;
      content: string;
      count: number;
    }>(`/computer-use/trajectories/export?${params.toString()}`);
  },
  replayTrajectory: (id: string, options?: { delayMs?: number; stopOnError?: boolean }) =>
    fetchApi<{
      success: boolean;
      source: ComputerUseTrajectoryDetail;
      replay: ComputerUseTrajectoryDetail | null;
      result: string;
    }>(`/computer-use/trajectories/${encodeURIComponent(id)}/replay`, {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    }),
  deleteTrajectory: (id: string) =>
    fetchApi<{ success: boolean }>(`/computer-use/trajectories/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

export interface SandboxBrowserStatus {
  dockerAvailable: boolean;
  imageBuilt: boolean;
  running: boolean;
  cdpPort: number;
  novncPort: number;
  cdpUrl: string;
  novncUrl: string;
  reason?: string;
}

export const sandboxBrowserApi = {
  getStatus: () => fetchApi<SandboxBrowserStatus>("/browser/sandbox/status"),
  start: () =>
    fetchApi<{
      success: boolean;
      status?: SandboxBrowserStatus;
      error?: string;
    }>("/browser/sandbox/start", { method: "POST" }),
  stop: () =>
    fetchApi<{ success: boolean; status?: SandboxBrowserStatus }>("/browser/sandbox/stop", {
      method: "POST",
    }),
};
