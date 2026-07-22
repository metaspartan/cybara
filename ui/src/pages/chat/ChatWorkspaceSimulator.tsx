import {
  ArrowLeft,
  Camera,
  CircleStop,
  House,
  Layers3,
  Loader2,
  MousePointer2,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Volume1,
  Volume2,
} from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type WheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { apiFetch } from "@/lib/auth";
import { connectStatusStream } from "@/lib/status-stream";
import { cn } from "@/lib/utils";
import {
  containerPointToSource,
  sourcePointToContainer,
  type PreviewSize,
} from "./previewGeometry";
import { simulatorPreviewPollDelay } from "./simulatorPreviewTiming";

type SimulatorPlatform = "ios" | "android";

interface SimulatorDevice {
  id: string;
  name: string;
  platform: SimulatorPlatform;
  state: "booted" | "shutdown" | "offline";
  runtime?: string;
  interactive: boolean;
}

interface SimulatorPlatformStatus {
  automation?: {
    installable: boolean;
    installed: boolean;
    installing: boolean;
    reason?: string;
  };
  supported: boolean;
  installed: boolean;
  interactive: boolean;
  reason?: string;
  devices: SimulatorDevice[];
}

interface SimulatorFrame {
  screenshot: string;
  contentType: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  revision: string;
  device: SimulatorDevice;
  interaction?: SimulatorInteraction;
}

interface SimulatorInteraction {
  action: "tap" | "swipe" | "text" | "key" | "open_url" | "install" | "launch" | "describe";
  endX?: number;
  endY?: number;
  source: "agent" | "user";
  updatedAt: number;
  x?: number;
  y?: number;
}

const REQUEST_TIMEOUT_MS = 25_000;
async function responseError(response: Response, fallback: string): Promise<Error> {
  const value: unknown = await response.json().catch(() => null);
  if (value && typeof value === "object") {
    const record = value as { error?: unknown; message?: unknown };
    const message = typeof record.message === "string" ? record.message : record.error;
    if (typeof message === "string" && message.trim()) return new Error(message);
  }
  return new Error(fallback);
}

function parseDevice(value: unknown): SimulatorDevice | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    (record.platform !== "ios" && record.platform !== "android") ||
    (record.state !== "booted" && record.state !== "shutdown" && record.state !== "offline")
  ) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    platform: record.platform,
    state: record.state,
    runtime: typeof record.runtime === "string" ? record.runtime : undefined,
    interactive: record.interactive === true,
  };
}

function parsePlatformStatus(value: unknown): SimulatorPlatformStatus | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const devices = Array.isArray(record.devices)
    ? record.devices.map(parseDevice).filter((device): device is SimulatorDevice => device !== null)
    : [];
  const automationRecord =
    record.automation && typeof record.automation === "object"
      ? (record.automation as Record<string, unknown>)
      : null;
  return {
    automation: automationRecord
      ? {
          installable: automationRecord.installable === true,
          installed: automationRecord.installed === true,
          installing: automationRecord.installing === true,
          reason: typeof automationRecord.reason === "string" ? automationRecord.reason : undefined,
        }
      : undefined,
    supported: record.supported === true,
    installed: record.installed === true,
    interactive: record.interactive === true,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    devices,
  };
}

function parseInteraction(value: unknown): SimulatorInteraction | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const actions = new Set([
    "tap",
    "swipe",
    "text",
    "key",
    "open_url",
    "install",
    "launch",
    "describe",
  ]);
  if (
    typeof record.action !== "string" ||
    !actions.has(record.action) ||
    (record.source !== "agent" && record.source !== "user") ||
    typeof record.updatedAt !== "number"
  ) {
    return undefined;
  }
  return {
    action: record.action as SimulatorInteraction["action"],
    endX: typeof record.endX === "number" ? record.endX : undefined,
    endY: typeof record.endY === "number" ? record.endY : undefined,
    source: record.source,
    updatedAt: record.updatedAt,
    x: typeof record.x === "number" ? record.x : undefined,
    y: typeof record.y === "number" ? record.y : undefined,
  };
}

function SimulatorControl({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      className="theme-muted-icon-button flex h-7 w-7 shrink-0 items-center justify-center rounded-md disabled:cursor-not-allowed disabled:opacity-35"
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      {children}
    </button>
  );
}

export function ChatWorkspaceSimulator({
  platform,
  sessionId,
  visible,
}: {
  platform: SimulatorPlatform;
  sessionId?: string | null;
  visible: boolean;
}): ReactElement {
  const [status, setStatus] = useState<SimulatorPlatformStatus | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [frame, setFrame] = useState<SimulatorFrame | null>(null);
  const [busy, setBusy] = useState(false);
  const [installingAutomation, setInstallingAutomation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewSurfaceSize, setPreviewSurfaceSize] = useState<PreviewSize | null>(null);
  const revisionRef = useRef("");
  const frameRequestRef = useRef(false);
  const lastInteractionAtRef = useRef(0);
  const automationAttemptRef = useRef(false);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async (): Promise<SimulatorPlatformStatus> => {
    const response = await apiFetch("/api/simulators/status", {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw await responseError(response, "Simulator status is unavailable");
    const value: unknown = await response.json();
    const data = value && typeof value === "object" ? (value as { data?: unknown }).data : null;
    const platformValue =
      data && typeof data === "object"
        ? (data as Record<SimulatorPlatform, unknown>)[platform]
        : null;
    const next = parsePlatformStatus(platformValue);
    if (!next) throw new Error("Simulator status returned an invalid response");
    setStatus(next);
    setSelectedId((current) => {
      if (next.devices.some((device) => device.id === current)) return current;
      return (
        next.devices.find((device) => device.state === "booted")?.id ?? next.devices[0]?.id ?? ""
      );
    });
    return next;
  }, [platform]);

  const loadFrame = useCallback(async (): Promise<void> => {
    if (!selectedId || frameRequestRef.current) return;
    frameRequestRef.current = true;
    try {
      const query = new URLSearchParams({ deviceId: selectedId });
      if (revisionRef.current) query.set("revision", revisionRef.current);
      const response = await apiFetch(`/api/simulators/${platform}/screenshot?${query}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw await responseError(response, "Simulator preview is unavailable");
      const value: unknown = await response.json();
      const payload =
        value && typeof value === "object"
          ? (value as { data?: Record<string, unknown> }).data
          : undefined;
      const device = parseDevice(payload?.device);
      const revision = typeof payload?.revision === "string" ? payload.revision : "";
      const screenshot = typeof payload?.screenshot === "string" ? payload.screenshot : null;
      if (device && typeof payload?.width === "number" && typeof payload?.height === "number") {
        setFrame((current) => {
          const image = screenshot
            ? `data:${String(payload.contentType || "image/png")};base64,${screenshot}`
            : current?.screenshot;
          if (!image) return current;
          return {
            screenshot: image,
            contentType: String(payload.contentType || current?.contentType || "image/png"),
            width: payload.width as number,
            height: payload.height as number,
            sourceWidth:
              typeof payload.sourceWidth === "number"
                ? payload.sourceWidth
                : (payload.width as number),
            sourceHeight:
              typeof payload.sourceHeight === "number"
                ? payload.sourceHeight
                : (payload.height as number),
            revision,
            device,
            interaction: parseInteraction(payload.interaction),
          };
        });
        revisionRef.current = revision;
      }
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Simulator preview is unavailable");
    } finally {
      frameRequestRef.current = false;
    }
  }, [platform, selectedId]);

  const installIosAutomation = useCallback(async (): Promise<void> => {
    if (automationAttemptRef.current) return;
    automationAttemptRef.current = true;
    setInstallingAutomation(true);
    setNotice("Installing direct iOS controls");
    setError(null);
    try {
      const response = await apiFetch("/api/simulators/ios/automation/install", {
        method: "POST",
        signal: AbortSignal.timeout(20 * 60 * 1000),
      });
      if (!response.ok) throw await responseError(response, "iOS control installation failed");
      await loadStatus();
      revisionRef.current = "";
      setNotice("Direct iOS controls ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "iOS control installation failed");
    } finally {
      setInstallingAutomation(false);
    }
  }, [loadStatus]);

  useEffect(() => {
    if (!visible) return;
    setBusy(true);
    void loadStatus()
      .then((next) => {
        if (
          platform === "ios" &&
          next.installed &&
          !next.interactive &&
          next.automation?.installable
        ) {
          void installIosAutomation();
        }
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Simulator status is unavailable");
      })
      .finally(() => setBusy(false));
  }, [installIosAutomation, loadStatus, platform, visible]);

  useEffect(() => {
    revisionRef.current = "";
    setFrame(null);
    setNotice(null);
  }, [selectedId]);

  const selectedDevice = status?.devices.find((device) => device.id === selectedId) ?? null;
  const hasFrame = frame !== null;

  useEffect(() => {
    if (!visible || selectedDevice?.state !== "booted") return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async (): Promise<void> => {
      if (document.visibilityState === "visible") await loadFrame();
      if (!cancelled) {
        timer = window.setTimeout(
          () => void poll(),
          simulatorPreviewPollDelay(Date.now(), lastInteractionAtRef.current)
        );
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadFrame, selectedDevice?.state, visible]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || typeof ResizeObserver === "undefined") return;
    const update = (): void => {
      const bounds = surface.getBoundingClientRect();
      setPreviewSurfaceSize({ width: bounds.width, height: bounds.height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    update();
    return () => observer.disconnect();
  }, [hasFrame]);

  useEffect(() => {
    const activeSessionId = sessionId?.trim();
    if (!visible || !activeSessionId) return;
    return connectStatusStream({
      onEvent: (event) => {
        if (
          event.type !== "status" ||
          event.sessionId !== activeSessionId ||
          event.toolName !== "mobile_simulator"
        ) {
          return;
        }
        lastInteractionAtRef.current = Date.now();
        if (event.status === "tool_completed" || event.toolPhase === "result") {
          void loadStatus().then(() => loadFrame());
        }
      },
    });
  }, [loadFrame, loadStatus, sessionId, visible]);

  const runLifecycle = async (action: "start" | "stop"): Promise<void> => {
    if (!selectedId || busy) return;
    lastInteractionAtRef.current = Date.now();
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/simulators/${platform}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: selectedId }),
        signal: AbortSignal.timeout(130_000),
      });
      if (!response.ok) throw await responseError(response, `Simulator ${action} failed`);
      revisionRef.current = "";
      setFrame(null);
      await loadStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Simulator ${action} failed`);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (): Promise<void> => {
    if (busy) return;
    lastInteractionAtRef.current = Date.now();
    setBusy(true);
    if (platform === "ios" && !status?.interactive) automationAttemptRef.current = false;
    try {
      const next = await loadStatus();
      if (
        platform === "ios" &&
        next.installed &&
        !next.interactive &&
        next.automation?.installable
      ) {
        await installIosAutomation();
      }
      await loadFrame();
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Simulator refresh failed");
    } finally {
      setBusy(false);
    }
  };

  const runAction = useCallback(
    async (action: Record<string, unknown>): Promise<void> => {
      if (!selectedId || busy) return;
      lastInteractionAtRef.current = Date.now();
      setNotice(null);
      try {
        const response = await apiFetch(`/api/simulators/${platform}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...action, deviceId: selectedId, sessionId }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw await responseError(response, "Simulator interaction failed");
        revisionRef.current = "";
        window.setTimeout(() => void loadFrame(), 100);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Simulator interaction failed");
      }
    },
    [busy, loadFrame, platform, selectedId, sessionId]
  );

  const saveScreenshot = async (): Promise<void> => {
    if (!selectedId || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/simulators/${platform}/screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: selectedId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw await responseError(response, "Simulator screenshot failed");
      const value: unknown = await response.json();
      const payload =
        value && typeof value === "object"
          ? (value as { data?: Record<string, unknown> }).data
          : undefined;
      const filePath = typeof payload?.filePath === "string" ? payload.filePath : "";
      setNotice(filePath ? `Saved ${filePath}` : "Screenshot saved");
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Simulator screenshot failed");
    } finally {
      setBusy(false);
    }
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!frame || !selectedDevice?.interactive) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = containerPointToSource(
      { width: bounds.width, height: bounds.height },
      { width: frame.width, height: frame.height },
      { width: frame.sourceWidth, height: frame.sourceHeight },
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    );
    if (!point) return;
    event.currentTarget.focus();
    void runAction({ action: "tap", x: point.x, y: point.y });
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (!frame || !selectedDevice?.interactive) return;
    event.preventDefault();
    const centerX = frame.sourceWidth / 2;
    const centerY = frame.sourceHeight / 2;
    const distance = Math.min(frame.sourceHeight * 0.3, Math.max(120, Math.abs(event.deltaY) * 2));
    const direction = event.deltaY >= 0 ? -1 : 1;
    void runAction({
      action: "swipe",
      x: centerX,
      y: centerY,
      endX: centerX,
      endY: centerY + direction * distance,
      durationMs: 250,
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!selectedDevice?.interactive) return;
    const named: Record<string, string> = {
      Backspace: "DELETE",
      Enter: "ENTER",
      Escape: "ESCAPE",
      Tab: "TAB",
    };
    if (platform === "android" && named[event.key]) {
      event.preventDefault();
      void runAction({ action: "key", key: named[event.key] });
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      void runAction({ action: "text", text: event.key });
    }
  };

  const label = platform === "ios" ? "iOS Simulator" : "Android Emulator";
  const interaction = frame?.interaction;
  const interactionX =
    interaction?.action === "swipe" ? (interaction.endX ?? interaction.x) : interaction?.x;
  const interactionY =
    interaction?.action === "swipe" ? (interaction.endY ?? interaction.y) : interaction?.y;
  const interactionPoint =
    interaction?.source === "agent" &&
    typeof interactionX === "number" &&
    typeof interactionY === "number" &&
    frame &&
    previewSurfaceSize
      ? sourcePointToContainer(
          previewSurfaceSize,
          { width: frame.width, height: frame.height },
          { width: frame.sourceWidth, height: frame.sourceHeight },
          { x: interactionX, y: interactionY }
        )
      : null;
  const interactionStyle = interactionPoint
    ? { left: `${interactionPoint.x}px`, top: `${interactionPoint.y}px` }
    : undefined;

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--chat-environment-panel-bg)]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 px-2.5">
        <Smartphone className="h-3.5 w-3.5 shrink-0 text-gray-500" />
        <select
          aria-label={`${label} device`}
          className="h-7 min-w-0 flex-1 truncate rounded-md border border-white/10 bg-white/[0.04] px-2 text-[11px] text-gray-300 outline-none"
          disabled={busy || installingAutomation || !status?.devices.length}
          onChange={(event) => setSelectedId(event.target.value)}
          value={selectedId}
        >
          {!status?.devices.length && <option value="">No devices</option>}
          {status?.devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
              {device.runtime ? ` · ${device.runtime}` : ""}
            </option>
          ))}
        </select>
        {selectedDevice?.state === "booted" ? (
          <button
            type="button"
            aria-label={`Stop ${label}`}
            className="rounded-md p-1.5 text-gray-500 hover:bg-white/[0.06] hover:text-gray-200"
            disabled={busy || installingAutomation}
            onClick={() => void runLifecycle("stop")}
          >
            <CircleStop className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Start ${label}`}
            className="rounded-md p-1.5 text-gray-500 hover:bg-white/[0.06] hover:text-gray-200"
            disabled={busy || installingAutomation || !selectedDevice}
            onClick={() => void runLifecycle("start")}
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label={`Refresh ${label}`}
          className="rounded-md p-1.5 text-gray-500 hover:bg-white/[0.06] hover:text-gray-200"
          disabled={busy || installingAutomation}
          onClick={() => void refresh()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-black/25 p-3">
        {frame ? (
          <div
            ref={surfaceRef}
            role="application"
            aria-label={`${label} preview`}
            className={cn(
              "relative flex h-full w-full items-center justify-center overflow-hidden outline-none",
              selectedDevice?.interactive && "cursor-crosshair"
            )}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            onWheel={handleWheel}
            tabIndex={selectedDevice?.interactive ? 0 : -1}
          >
            <img
              alt={`${selectedDevice?.name || label} screen`}
              className="max-h-full max-w-full select-none object-contain"
              draggable={false}
              src={frame.screenshot}
            />
            {interactionStyle ? (
              <div
                className="pointer-events-none absolute z-20 -translate-x-[2px] -translate-y-[1px] transition-[left,top] duration-150 ease-out"
                data-testid="simulator-agent-cursor"
                style={interactionStyle}
              >
                {interaction?.action === "tap" ? (
                  <span
                    key={interaction.updatedAt}
                    className="browser-agent-click-pulse absolute -left-2 -top-2 h-5 w-5 rounded-full border border-[rgba(var(--accent-primary),0.8)]"
                    data-testid="simulator-agent-tap"
                  />
                ) : null}
                <MousePointer2 className="relative h-4 w-4 fill-black stroke-[2.5] text-white drop-shadow-[0_0_5px_rgba(var(--accent-primary),0.95)]" />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            {busy || installingAutomation ? (
              <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
            ) : selectedDevice?.state === "booted" ? (
              <RotateCcw className="h-5 w-5 text-gray-600" />
            ) : (
              <Smartphone className="h-6 w-6 text-gray-600" />
            )}
            <p className="max-w-80 text-[12px] text-gray-400">
              {status?.reason ||
                (selectedDevice?.state === "booted"
                  ? `Loading ${label} preview`
                  : selectedDevice
                    ? `Start ${selectedDevice.name} to preview it here`
                    : `${label} is not configured`)}
            </p>
          </div>
        )}
        {error && (
          <div className="absolute inset-x-3 bottom-3 rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
            {error}
          </div>
        )}
      </div>

      <footer className="flex h-10 shrink-0 items-center gap-2 border-t border-white/10 px-2 text-[10px] text-gray-500">
        <span className="min-w-0 flex-1 truncate" title={notice ?? undefined}>
          {notice || (selectedDevice?.state === "booted" ? "Running" : "Stopped")}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {platform === "android" ? (
            <SimulatorControl
              disabled={!selectedDevice?.interactive || busy || installingAutomation}
              label="Back"
              onClick={() => void runAction({ action: "key", key: "BACK" })}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </SimulatorControl>
          ) : null}
          <SimulatorControl
            disabled={!selectedDevice?.interactive || busy || installingAutomation}
            label="Home"
            onClick={() => void runAction({ action: "key", key: "HOME" })}
          >
            <House className="h-3.5 w-3.5" />
          </SimulatorControl>
          {platform === "android" ? (
            <>
              <SimulatorControl
                disabled={!selectedDevice?.interactive || busy || installingAutomation}
                label="Recent apps"
                onClick={() => void runAction({ action: "key", key: "RECENTS" })}
              >
                <Layers3 className="h-3.5 w-3.5" />
              </SimulatorControl>
              <SimulatorControl
                disabled={!selectedDevice?.interactive || busy || installingAutomation}
                label="Volume down"
                onClick={() => void runAction({ action: "key", key: "VOLUME_DOWN" })}
              >
                <Volume1 className="h-3.5 w-3.5" />
              </SimulatorControl>
              <SimulatorControl
                disabled={!selectedDevice?.interactive || busy || installingAutomation}
                label="Volume up"
                onClick={() => void runAction({ action: "key", key: "VOLUME_UP" })}
              >
                <Volume2 className="h-3.5 w-3.5" />
              </SimulatorControl>
            </>
          ) : null}
          <SimulatorControl
            disabled={!selectedDevice?.interactive || busy || installingAutomation}
            label={platform === "ios" ? "Side button" : "Power"}
            onClick={() =>
              void runAction({
                action: "key",
                key: platform === "ios" ? "SIDE_BUTTON" : "POWER",
              })
            }
          >
            <Power className="h-3.5 w-3.5" />
          </SimulatorControl>
          <SimulatorControl
            disabled={selectedDevice?.state !== "booted" || busy || installingAutomation}
            label="Save screenshot"
            onClick={() => void saveScreenshot()}
          >
            <Camera className="h-3.5 w-3.5" />
          </SimulatorControl>
        </div>
        <span className="hidden min-w-0 flex-1 truncate text-right min-[520px]:block">
          {interaction?.source === "agent"
            ? `Agent ${interaction.action.replace(/_/g, " ")}`
            : selectedDevice?.interactive
              ? "Direct input enabled"
              : "Preview mode"}
        </span>
      </footer>
    </section>
  );
}
