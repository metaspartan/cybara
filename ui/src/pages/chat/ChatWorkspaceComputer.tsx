import { Loader2, Monitor, MousePointer2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/auth";
import { previewPointToContainer, type PreviewSize } from "./previewGeometry";

interface ComputerCursor {
  x: number;
  y: number;
  visible: boolean;
  action: "move" | "click" | "type" | "drag";
  updatedAt: number;
}

interface ComputerPreview {
  action: string;
  app?: string;
  screenshot?: string;
  contentType?: string;
  viewport?: ImageSize;
  cursor?: ComputerCursor;
  updatedAt: number;
  revision: number;
  screenshotRevision: number;
}

interface ImageSize {
  width: number;
  height: number;
}

const COMPUTER_PREVIEW_POLL_MS = 300;

function parseComputerPreview(value: unknown): ComputerPreview | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.action !== "string" ||
    typeof record.updatedAt !== "number" ||
    typeof record.revision !== "number" ||
    typeof record.screenshotRevision !== "number"
  ) {
    return null;
  }
  const cursorRecord =
    record.cursor && typeof record.cursor === "object"
      ? (record.cursor as Record<string, unknown>)
      : null;
  const cursorAction: ComputerCursor["action"] =
    cursorRecord?.action === "click" ||
    cursorRecord?.action === "type" ||
    cursorRecord?.action === "drag"
      ? cursorRecord.action
      : "move";
  const cursor: ComputerCursor | undefined =
    cursorRecord &&
    typeof cursorRecord.x === "number" &&
    typeof cursorRecord.y === "number" &&
    typeof cursorRecord.visible === "boolean" &&
    typeof cursorRecord.updatedAt === "number"
      ? {
          x: cursorRecord.x,
          y: cursorRecord.y,
          visible: cursorRecord.visible,
          action: cursorAction,
          updatedAt: cursorRecord.updatedAt,
        }
      : undefined;
  const viewportRecord =
    record.viewport && typeof record.viewport === "object"
      ? (record.viewport as Record<string, unknown>)
      : null;
  const viewport: ImageSize | undefined =
    viewportRecord &&
    typeof viewportRecord.width === "number" &&
    typeof viewportRecord.height === "number"
      ? { width: viewportRecord.width, height: viewportRecord.height }
      : undefined;
  return {
    action: record.action,
    app: typeof record.app === "string" ? record.app : undefined,
    screenshot: typeof record.screenshot === "string" ? record.screenshot : undefined,
    contentType: typeof record.contentType === "string" ? record.contentType : undefined,
    viewport,
    cursor,
    updatedAt: record.updatedAt,
    revision: record.revision,
    screenshotRevision: record.screenshotRevision,
  };
}

export function ChatWorkspaceComputer({
  sessionId,
  visible,
}: {
  sessionId?: string | null;
  visible: boolean;
}) {
  const resolvedSessionId = sessionId?.trim() || "preview-new-chat";
  const [preview, setPreview] = useState<ComputerPreview | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [error, setError] = useState<string | null>(null);
  const screenshotRevisionRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const previewSurfaceRef = useRef<HTMLDivElement>(null);
  const [previewSurfaceSize, setPreviewSurfaceSize] = useState<PreviewSize | null>(null);

  const refresh = useCallback(async () => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    try {
      const query = new URLSearchParams({
        sessionId: resolvedSessionId,
        screenshotRevision: String(screenshotRevisionRef.current),
      });
      const response = await apiFetch(`/api/computer-use/preview?${query}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("Desktop preview is unavailable");
      const body: unknown = await response.json();
      const payload =
        body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
      const next = parseComputerPreview(payload);
      if (!next) {
        setError(null);
        return;
      }
      if (next.screenshot) {
        setImageUrl(`data:${next.contentType || "image/png"};base64,${next.screenshot}`);
        screenshotRevisionRef.current = next.screenshotRevision;
      }
      setPreview((current) => ({
        ...next,
        screenshot: next.screenshot ?? current?.screenshot,
      }));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Desktop preview is unavailable");
    } finally {
      requestInFlightRef.current = false;
    }
  }, [resolvedSessionId]);

  useEffect(() => {
    setPreview(null);
    setImageUrl("");
    setImageSize(null);
    screenshotRevisionRef.current = 0;
  }, [resolvedSessionId]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      if (document.visibilityState === "visible") await refresh();
      if (!cancelled) timer = window.setTimeout(() => void poll(), COMPUTER_PREVIEW_POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refresh, visible]);

  useEffect(() => {
    const surface = previewSurfaceRef.current;
    if (!surface || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const bounds = surface.getBoundingClientRect();
      setPreviewSurfaceSize({ width: bounds.width, height: bounds.height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    update();
    return () => observer.disconnect();
  }, []);

  const clear = async () => {
    const query = new URLSearchParams({ sessionId: resolvedSessionId });
    await apiFetch(`/api/computer-use/preview?${query}`, { method: "DELETE" });
    setPreview(null);
    setImageUrl("");
    setImageSize(null);
    screenshotRevisionRef.current = 0;
  };

  const cursorDimensions = preview?.viewport ?? imageSize;
  const cursorPoint =
    preview?.cursor?.visible && cursorDimensions && previewSurfaceSize
      ? previewPointToContainer(previewSurfaceSize, cursorDimensions, preview.cursor)
      : null;
  const cursorStyle = cursorPoint
    ? { left: `${cursorPoint.x}px`, top: `${cursorPoint.y}px` }
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--chat-environment-panel-bg)]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        <Monitor className="h-3.5 w-3.5 text-gray-500" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">
          {preview
            ? `${preview.app || "Desktop"} · ${preview.action.replace(/_/g, " ")}`
            : "Desktop"}
        </span>
        {preview ? (
          <button
            type="button"
            className="rounded-md p-1.5 text-gray-500 hover:bg-white/[0.06] hover:text-gray-200"
            onClick={() => void clear()}
            aria-label="Clear desktop preview"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </header>
      <div ref={previewSurfaceRef} className="relative min-h-0 flex-1 overflow-hidden bg-[#111216]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Agent desktop preview"
            className="absolute inset-0 h-full w-full select-none object-contain"
            draggable={false}
            onLoad={(event) =>
              setImageSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              {visible && !error ? (
                <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-gray-600" />
              ) : (
                <Monitor className="mx-auto mb-3 h-7 w-7 text-gray-700" />
              )}
              <p className="text-xs text-gray-500">
                {error || "Waiting for computer-use activity in this chat"}
              </p>
            </div>
          </div>
        )}
        {cursorStyle ? (
          <div
            className="pointer-events-none absolute z-20 -translate-x-[2px] -translate-y-[1px] transition-[left,top] duration-150 ease-out"
            style={cursorStyle}
            data-testid="computer-agent-cursor"
          >
            {preview?.cursor?.action === "click" ? (
              <span
                key={preview.cursor.updatedAt}
                className="browser-agent-click-pulse absolute -left-2 -top-2 h-5 w-5 rounded-full border border-blue-300/80"
              />
            ) : null}
            <MousePointer2 className="relative h-4 w-4 fill-black stroke-[2.5] text-white drop-shadow-[0_0_5px_rgba(96,165,250,0.95)]" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
