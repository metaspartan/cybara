import { CircleStop, Loader2, Play, RefreshCw, RotateCcw, Smartphone } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type WheelEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { containerPointToPreview } from "./previewGeometry";

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
  revision: string;
  device: SimulatorDevice;
}

const REQUEST_TIMEOUT_MS = 25_000;
const FRAME_POLL_MS = 400;

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
  return {
    supported: record.supported === true,
    installed: record.installed === true,
    interactive: record.interactive === true,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    devices,
  };
}

export function ChatWorkspaceSimulator({
  platform,
  visible,
}: {
  platform: SimulatorPlatform;
  visible: boolean;
}): ReactElement {
  const [status, setStatus] = useState<SimulatorPlatformStatus | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [frame, setFrame] = useState<SimulatorFrame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revisionRef = useRef("");
  const frameRequestRef = useRef(false);
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
            revision,
            device,
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

  useEffect(() => {
    if (!visible) return;
    setBusy(true);
    void loadStatus()
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Simulator status is unavailable");
      })
      .finally(() => setBusy(false));
  }, [loadStatus, visible]);

  useEffect(() => {
    revisionRef.current = "";
    setFrame(null);
  }, [selectedId]);

  const selectedDevice = status?.devices.find((device) => device.id === selectedId) ?? null;

  useEffect(() => {
    if (!visible || selectedDevice?.state !== "booted") return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async (): Promise<void> => {
      if (document.visibilityState === "visible") await loadFrame();
      if (!cancelled) timer = window.setTimeout(() => void poll(), FRAME_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadFrame, selectedDevice?.state, visible]);

  const runLifecycle = async (action: "start" | "stop"): Promise<void> => {
    if (!selectedId || busy) return;
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
    setBusy(true);
    try {
      await loadStatus();
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
      try {
        const response = await apiFetch(`/api/simulators/${platform}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...action, deviceId: selectedId }),
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
    [busy, loadFrame, platform, selectedId]
  );

  const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!frame || !selectedDevice?.interactive) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = containerPointToPreview(
      { width: bounds.width, height: bounds.height },
      { width: frame.width, height: frame.height },
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    );
    if (!point) return;
    event.currentTarget.focus();
    void runAction({ action: "tap", x: point.x, y: point.y });
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (!frame || !selectedDevice?.interactive) return;
    event.preventDefault();
    const centerX = frame.width / 2;
    const centerY = frame.height / 2;
    const distance = Math.min(frame.height * 0.3, Math.max(120, Math.abs(event.deltaY) * 2));
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
    if (named[event.key]) {
      event.preventDefault();
      void runAction({ action: "key", key: named[event.key] });
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      void runAction({ action: "text", text: event.key });
    }
  };

  const label = platform === "ios" ? "iOS Simulator" : "Android Emulator";

  return (
    <section className="flex h-full min-h-0 flex-col bg-[var(--chat-environment-panel-bg)]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 px-2.5">
        <Smartphone className="h-3.5 w-3.5 shrink-0 text-gray-500" />
        <select
          aria-label={`${label} device`}
          className="h-7 min-w-0 flex-1 truncate rounded-md border border-white/10 bg-white/[0.04] px-2 text-[11px] text-gray-300 outline-none"
          disabled={busy || !status?.devices.length}
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
            disabled={busy}
            onClick={() => void runLifecycle("stop")}
          >
            <CircleStop className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Start ${label}`}
            className="rounded-md p-1.5 text-gray-500 hover:bg-white/[0.06] hover:text-gray-200"
            disabled={busy || !selectedDevice}
            onClick={() => void runLifecycle("start")}
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label={`Refresh ${label}`}
          className="rounded-md p-1.5 text-gray-500 hover:bg-white/[0.06] hover:text-gray-200"
          disabled={busy}
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
              "flex h-full w-full items-center justify-center overflow-hidden outline-none",
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
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            {busy ? (
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

      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-white/10 px-3 text-[10px] text-gray-500">
        <span>{selectedDevice?.state === "booted" ? "Running" : "Stopped"}</span>
        <span>{selectedDevice?.interactive ? "Direct input enabled" : "Preview mode"}</span>
      </footer>
    </section>
  );
}
