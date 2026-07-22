import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  Loader2,
  MousePointer2,
  RefreshCw,
} from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { apiFetch } from "@/lib/auth";
import { connectStatusStream } from "@/lib/status-stream";
import { cn } from "@/lib/utils";
import { openExternal } from "@/utils/openExternal";
import {
  containerPointToPreview,
  previewPointToContainer,
  type PreviewSize,
} from "./previewGeometry";
import { routeChatLink } from "./chatLinkRouting";
import { browserPreviewPollDelay } from "./browserPreviewTiming";

interface BrowserPage {
  id: string;
  title?: string;
  url?: string;
}

interface BrowserCursor {
  x: number;
  y: number;
  visible: boolean;
  updatedAt: number;
  action: "move" | "click" | "type";
  source: "agent" | "user";
}

interface BrowserViewport {
  width: number;
  height: number;
}

interface BrowserPreview {
  screenshot: string;
  revision: string;
  cursor: BrowserCursor | null;
  viewport: BrowserViewport | null;
  page: BrowserPage | null;
}

interface PendingBrowserPage {
  sessionId: string;
  promise: Promise<BrowserPage>;
}

const DEFAULT_BROWSER_VIEWPORT: BrowserViewport = { width: 960, height: 640 };
const BROWSER_START_TIMEOUT_MS = 90_000;
const BROWSER_REQUEST_TIMEOUT_MS = 12_000;
const BROWSER_PREVIEW_QUALITY = 58;

interface BrowserLaunchStatus {
  phase: "idle" | "starting" | "running" | "failed";
  attempt?: string;
  attempted?: number;
  total?: number;
  error?: string;
}

async function readBrowserLaunchStatus(): Promise<BrowserLaunchStatus | null> {
  const response = await apiFetch("/api/browser/status", {
    signal: AbortSignal.timeout(BROWSER_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data: unknown = await response.json();
  if (!data || typeof data !== "object") return null;
  const launch = (data as { launch?: unknown }).launch;
  if (!launch || typeof launch !== "object") return null;
  const record = launch as Record<string, unknown>;
  if (
    record.phase !== "idle" &&
    record.phase !== "starting" &&
    record.phase !== "running" &&
    record.phase !== "failed"
  ) {
    return null;
  }
  return {
    phase: record.phase,
    attempt: typeof record.attempt === "string" ? record.attempt : undefined,
    attempted: typeof record.attempted === "number" ? record.attempted : undefined,
    total: typeof record.total === "number" ? record.total : undefined,
    error: typeof record.error === "string" ? record.error : undefined,
  };
}

function browserStartupLabel(status: BrowserLaunchStatus | null): string {
  if (!status || status.phase === "idle") return "Checking installed browsers";
  if (status.phase === "failed") return status.error || "Browser preview could not start";
  if (status.phase === "running") return "Preparing browser preview";
  const progress =
    status.attempted && status.total ? ` (${status.attempted} of ${status.total})` : "";
  return `Starting ${status.attempt || "browser"}${progress}`;
}

function parseBrowserPage(value: unknown): BrowserPage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") return null;
  return {
    id: record.id,
    title: typeof record.title === "string" ? record.title : undefined,
    url: typeof record.url === "string" ? record.url : undefined,
  };
}

function parseBrowserCursor(value: unknown): BrowserCursor | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.x !== "number" ||
    typeof record.y !== "number" ||
    typeof record.visible !== "boolean" ||
    typeof record.updatedAt !== "number"
  ) {
    return null;
  }
  return {
    x: record.x,
    y: record.y,
    visible: record.visible,
    updatedAt: record.updatedAt,
    action:
      record.action === "click" || record.action === "type" || record.action === "move"
        ? record.action
        : "move",
    source: record.source === "user" ? "user" : "agent",
  };
}

function parseBrowserViewport(value: unknown): BrowserViewport | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.width !== "number" || typeof record.height !== "number") return null;
  return { width: record.width, height: record.height };
}

function sameBrowserPage(left: BrowserPage | null, right: BrowserPage | null): boolean {
  return left?.id === right?.id && left?.title === right?.title && left?.url === right?.url;
}

function sameBrowserCursor(left: BrowserCursor | null, right: BrowserCursor | null): boolean {
  return (
    left?.x === right?.x &&
    left?.y === right?.y &&
    left?.visible === right?.visible &&
    left?.updatedAt === right?.updatedAt &&
    left?.action === right?.action &&
    left?.source === right?.source
  );
}

function sameBrowserViewport(left: BrowserViewport | null, right: BrowserViewport | null): boolean {
  return left?.width === right?.width && left?.height === right?.height;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const data: unknown = await response.json().catch(() => null);
  if (data && typeof data === "object") {
    const message = (data as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) return new Error(message);
  }
  return new Error(fallback);
}

async function readSessionPage(sessionId: string): Promise<BrowserPage | null> {
  const response = await apiFetch(`/api/browser/tabs?sessionId=${encodeURIComponent(sessionId)}`, {
    signal: AbortSignal.timeout(BROWSER_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw await responseError(response, "Browser preview is unavailable");
  const data: unknown = await response.json();
  const tabs =
    data && typeof data === "object" && Array.isArray((data as { tabs?: unknown }).tabs)
      ? (data as { tabs: unknown[] }).tabs
      : [];
  return tabs.map(parseBrowserPage).find((page): page is BrowserPage => page !== null) ?? null;
}

async function createSessionPage(sessionId: string): Promise<BrowserPage> {
  const response = await apiFetch("/api/browser/tabs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
    signal: AbortSignal.timeout(BROWSER_START_TIMEOUT_MS),
  });
  if (!response.ok) throw await responseError(response, "Failed to start browser preview");
  const data: unknown = await response.json();
  const id =
    data && typeof data === "object" ? (data as { data?: { id?: unknown } }).data?.id : undefined;
  if (typeof id !== "string") throw new Error("Browser page was not created");
  return { id };
}

export function ChatWorkspaceBrowser({
  visible,
  sessionId,
  pageKey,
  navigationRequest,
  navigationUrl,
  onTitleChange,
}: {
  visible: boolean;
  sessionId?: string | null;
  pageKey?: string;
  navigationRequest?: number;
  navigationUrl?: string;
  onTitleChange?: (title: string) => void;
}) {
  const baseSessionId = sessionId?.trim() || "preview-new-chat";
  const browserSessionId = pageKey?.trim() ? `${baseSessionId}::${pageKey.trim()}` : baseSessionId;
  const [page, setPage] = useState<BrowserPage | null>(null);
  const [address, setAddress] = useState("");
  const [preview, setPreview] = useState<BrowserPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startupLabel, setStartupLabel] = useState("Checking installed browsers");
  const addressRef = useRef<HTMLInputElement>(null);
  const previewSurfaceRef = useRef<HTMLDivElement>(null);
  const requestInFlightRef = useRef(false);
  const stateRequestInFlightRef = useRef(false);
  const pendingPageRef = useRef<PendingBrowserPage | null>(null);
  const lastInteractionAtRef = useRef(Date.now());
  const previewRevisionRef = useRef("");
  const lastNavigationRequestRef = useRef(0);
  const onTitleChangeRef = useRef(onTitleChange);
  const [browserViewport, setBrowserViewport] = useState(DEFAULT_BROWSER_VIEWPORT);
  const [previewSurfaceSize, setPreviewSurfaceSize] = useState<PreviewSize | null>(null);
  onTitleChangeRef.current = onTitleChange;

  const syncPage = useCallback((nextPage: BrowserPage | null) => {
    setPage((current) => {
      if (
        current?.id === nextPage?.id &&
        current?.title === nextPage?.title &&
        current?.url === nextPage?.url
      ) {
        return current;
      }
      return nextPage;
    });
    if (nextPage && document.activeElement !== addressRef.current) {
      setAddress(nextPage.url ?? "");
    }
    onTitleChangeRef.current?.(nextPage?.title?.trim() || "Browser");
  }, []);

  const ensurePage = useCallback((): Promise<BrowserPage> => {
    const pending = pendingPageRef.current;
    if (pending?.sessionId === browserSessionId) return pending.promise;
    const promise = readSessionPage(browserSessionId)
      .then(async (existing) => existing ?? (await createSessionPage(browserSessionId)))
      .then((nextPage) => {
        syncPage(nextPage);
        return nextPage;
      })
      .finally(() => {
        if (pendingPageRef.current?.promise === promise) pendingPageRef.current = null;
      });
    pendingPageRef.current = { sessionId: browserSessionId, promise };
    return promise;
  }, [browserSessionId, syncPage]);

  const loadPreview = useCallback(
    async (targetPage: BrowserPage) => {
      if (requestInFlightRef.current) return;
      requestInFlightRef.current = true;
      try {
        const query = new URLSearchParams({
          fullPage: "false",
          format: "jpeg",
          quality: String(BROWSER_PREVIEW_QUALITY),
          viewportWidth: String(browserViewport.width),
          viewportHeight: String(browserViewport.height),
        });
        if (previewRevisionRef.current) query.set("revision", previewRevisionRef.current);
        const response = await apiFetch(
          `/api/browser/tabs/${encodeURIComponent(targetPage.id)}/screenshot?${query}`,
          { signal: AbortSignal.timeout(BROWSER_REQUEST_TIMEOUT_MS) }
        );
        if (response.status === 404) {
          const replacement = await createSessionPage(browserSessionId);
          setPreview(null);
          previewRevisionRef.current = "";
          syncPage(replacement);
          return;
        }
        if (!response.ok) throw await responseError(response, "Browser preview is unavailable");
        const data: unknown = await response.json();
        const payload =
          data && typeof data === "object"
            ? (data as { data?: Record<string, unknown> }).data
            : null;
        const screenshot = payload?.screenshot;
        const unchanged = payload?.unchanged === true;
        if (!unchanged && typeof screenshot !== "string") {
          throw new Error("Browser preview is unavailable");
        }
        const revision = typeof payload?.revision === "string" ? payload.revision : "";
        const nextPage = parseBrowserPage(payload?.page) ?? targetPage;
        const nextScreenshot =
          typeof screenshot === "string"
            ? `data:${String(payload?.contentType || "image/jpeg")};base64,${screenshot}`
            : null;
        const nextCursor = parseBrowserCursor(payload?.cursor);
        const nextViewport = parseBrowserViewport(payload?.viewport);
        setPreview((current) => {
          const resolvedScreenshot = nextScreenshot ?? current?.screenshot ?? "";
          if (
            current?.screenshot === resolvedScreenshot &&
            current?.revision === revision &&
            sameBrowserCursor(current.cursor, nextCursor) &&
            sameBrowserViewport(current.viewport, nextViewport) &&
            sameBrowserPage(current.page, nextPage)
          ) {
            return current;
          }
          return {
            screenshot: resolvedScreenshot,
            revision,
            cursor: nextCursor,
            viewport: nextViewport,
            page: nextPage,
          };
        });
        previewRevisionRef.current = revision;
        syncPage(nextPage);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Failed to load browser preview");
      } finally {
        requestInFlightRef.current = false;
      }
    },
    [browserSessionId, browserViewport.height, browserViewport.width, syncPage]
  );

  const loadBrowserState = useCallback(
    async (targetPage: BrowserPage) => {
      if (stateRequestInFlightRef.current) return;
      stateRequestInFlightRef.current = true;
      try {
        const response = await apiFetch(
          `/api/browser/tabs/${encodeURIComponent(targetPage.id)}/state?includePage=false`,
          { signal: AbortSignal.timeout(BROWSER_REQUEST_TIMEOUT_MS) }
        );
        if (!response.ok) return;
        const data: unknown = await response.json();
        const payload =
          data && typeof data === "object"
            ? (data as { data?: Record<string, unknown> }).data
            : null;
        const nextPage = parseBrowserPage(payload?.page) ?? targetPage;
        const cursor = parseBrowserCursor(payload?.cursor);
        const viewport = parseBrowserViewport(payload?.viewport);
        setPreview((current) => {
          if (
            current &&
            sameBrowserCursor(current.cursor, cursor) &&
            sameBrowserViewport(current.viewport, viewport) &&
            sameBrowserPage(current.page, nextPage)
          ) {
            return current;
          }
          return current
            ? { ...current, cursor, viewport, page: nextPage }
            : {
                screenshot: "",
                revision: "",
                cursor,
                viewport,
                page: nextPage,
              };
        });
        syncPage(nextPage);
      } finally {
        stateRequestInFlightRef.current = false;
      }
    },
    [syncPage]
  );

  useEffect(() => {
    const surface = previewSurfaceRef.current;
    if (!surface || typeof ResizeObserver === "undefined") return;
    let timer: number | null = null;
    const updateViewport = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const bounds = surface.getBoundingClientRect();
        setPreviewSurfaceSize({ width: bounds.width, height: bounds.height });
        const width = Math.min(2560, Math.max(320, Math.round(bounds.width)));
        const height = Math.min(1600, Math.max(320, Math.round(bounds.height)));
        setBrowserViewport((current) =>
          current.width === width && current.height === height ? current : { width, height }
        );
      }, 100);
    };
    const observer = new ResizeObserver(updateViewport);
    observer.observe(surface);
    updateViewport();
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (navigationUrl && navigationRequest) return;
    let cancelled = false;
    setLoading(true);
    void ensurePage()
      .then((nextPage) => {
        if (!cancelled) return loadPreview(nextPage);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Failed to start browser preview");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ensurePage, loadPreview, navigationRequest, navigationUrl, visible]);

  useEffect(() => {
    if (!visible || !loading || preview?.screenshot) return;
    let cancelled = false;
    const refresh = async () => {
      const status = await readBrowserLaunchStatus().catch(() => null);
      if (!cancelled) setStartupLabel(browserStartupLabel(status));
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loading, preview?.screenshot, visible]);

  useEffect(() => {
    if (!visible || !page) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      if (document.visibilityState === "visible") await loadPreview(page);
      if (!cancelled) {
        timer = window.setTimeout(
          () => void poll(),
          browserPreviewPollDelay(Date.now(), lastInteractionAtRef.current, loading)
        );
      }
    };
    timer = window.setTimeout(
      () => void poll(),
      browserPreviewPollDelay(Date.now(), lastInteractionAtRef.current, loading)
    );
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadPreview, loading, page, visible]);

  useEffect(() => {
    const activeSessionId = sessionId?.trim();
    if (!visible || !page || !activeSessionId) return;
    return connectStatusStream({
      onEvent: (event) => {
        if (
          event.type !== "status" ||
          event.sessionId !== activeSessionId ||
          event.toolName !== "browser"
        ) {
          return;
        }
        lastInteractionAtRef.current = Date.now();
        if (event.status === "tool_completed" || event.toolPhase === "result") {
          void loadPreview(page);
        }
      },
    });
  }, [loadPreview, page, sessionId, visible]);

  const runPageAction = async (action: "back" | "forward" | "reload") => {
    if (!page || loading) return;
    lastInteractionAtRef.current = Date.now();
    setLoading(true);
    try {
      const response = await apiFetch(
        `/api/browser/tabs/${encodeURIComponent(page.id)}/${action}`,
        { method: "POST" }
      );
      if (!response.ok) throw await responseError(response, `Browser ${action} failed`);
      const data: unknown = await response.json();
      const nextPage = parseBrowserPage(
        data && typeof data === "object" ? (data as { data?: unknown }).data : null
      );
      if (nextPage) syncPage({ ...nextPage, id: page.id });
      await loadPreview(nextPage ? { ...nextPage, id: page.id } : page);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Browser ${action} failed`);
    } finally {
      setLoading(false);
    }
  };

  const navigateTo = useCallback(
    async (target: string): Promise<void> => {
      lastInteractionAtRef.current = Date.now();
      setLoading(true);
      try {
        const activePage = page ?? (await ensurePage());
        const response = await apiFetch(
          `/api/browser/tabs/${encodeURIComponent(activePage.id)}/navigate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: target,
              waitUntil: "domcontentloaded",
            }),
          }
        );
        if (!response.ok) {
          throw await responseError(response, `Navigation returned ${response.status}`);
        }
        const data: unknown = await response.json();
        const nextPage = parseBrowserPage(
          data && typeof data === "object" ? (data as { data?: unknown }).data : null
        );
        const resolvedPage = nextPage ? { ...nextPage, id: activePage.id } : activePage;
        previewRevisionRef.current = "";
        syncPage(resolvedPage);
        await loadPreview(resolvedPage);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Navigation failed");
      } finally {
        setLoading(false);
      }
    },
    [ensurePage, loadPreview, page, syncPage]
  );

  const navigate = (): void => {
    const target = address.trim();
    if (!target) return;
    void navigateTo(target);
  };

  useEffect(() => {
    if (!visible || !navigationUrl || !navigationRequest) return;
    if (lastNavigationRequestRef.current === navigationRequest) return;
    lastNavigationRequestRef.current = navigationRequest;
    setAddress(navigationUrl);
    void navigateTo(navigationUrl);
  }, [navigateTo, navigationRequest, navigationUrl, visible]);

  const sendPageInput = useCallback(
    async (action: "pointer/click" | "scroll" | "keyboard", body: Record<string, unknown>) => {
      if (!page) return;
      lastInteractionAtRef.current = Date.now();
      try {
        const response = await apiFetch(
          `/api/browser/tabs/${encodeURIComponent(page.id)}/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!response.ok) throw await responseError(response, "Browser interaction failed");
        await loadBrowserState(page);
        window.setTimeout(() => void loadPreview(page), 120);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Browser interaction failed");
      }
    },
    [loadBrowserState, loadPreview, page]
  );

  const handlePreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!page || !preview?.viewport) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = containerPointToPreview(
      { width: bounds.width, height: bounds.height },
      preview.viewport,
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    );
    if (!point) return;
    event.currentTarget.focus();
    void sendPageInput("pointer/click", { x: point.x, y: point.y });
  };

  const handlePreviewWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!page) return;
    event.preventDefault();
    void sendPageInput("scroll", {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
  };

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!page) return;
    const modifier = event.metaKey ? "Meta" : event.ctrlKey ? "Control" : null;
    const key = modifier ? `${modifier}+${event.key.toUpperCase()}` : event.key;
    const supportedNamedKeys = new Set([
      "Backspace",
      "Delete",
      "Enter",
      "Escape",
      "Tab",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
    ]);
    if (!modifier && event.key.length !== 1 && !supportedNamedKeys.has(event.key)) return;
    event.preventDefault();
    void sendPageInput("keyboard", { key });
  };

  const cursorStyle = (() => {
    const cursor = preview?.cursor;
    const viewport = preview?.viewport;
    if (!cursor?.visible || cursor.source !== "agent" || !viewport || !previewSurfaceSize) {
      return null;
    }
    const point = previewPointToContainer(previewSurfaceSize, viewport, cursor);
    if (!point) return null;
    return {
      left: `${point.x}px`,
      top: `${point.y}px`,
    };
  })();

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[var(--chat-environment-panel-bg)]"
      data-browser-session-id={browserSessionId}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-white/10 px-2">
        <button
          type="button"
          onClick={() => void runPageAction("back")}
          disabled={!page || loading}
          className="workspace-browser-nav-button"
          aria-label="Go back"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void runPageAction("forward")}
          disabled={!page || loading}
          className="workspace-browser-nav-button"
          aria-label="Go forward"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void runPageAction("reload")}
          disabled={!page || loading}
          className="workspace-browser-nav-button"
          aria-label="Reload page"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
        <input
          ref={addressRef}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void navigate();
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-center text-[11px] text-gray-200 outline-none focus:border-white/20 focus:shadow-none"
          placeholder="Search or enter address"
          aria-label="Browser address"
        />
        <button
          type="button"
          onClick={() => {
            const target = page?.url?.trim() || address.trim();
            const route = routeChatLink(target, { external: true });
            if (route.kind === "external") void openExternal(route.url);
          }}
          disabled={!page?.url && !address.trim()}
          className="workspace-browser-nav-button"
          title="Open in system browser"
          aria-label="Open in system browser"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        ref={previewSurfaceRef}
        className="relative min-h-0 flex-1 cursor-default overflow-hidden bg-[#111216] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400/35"
        onClick={handlePreviewClick}
        onKeyDown={handlePreviewKeyDown}
        onWheel={handlePreviewWheel}
        role="application"
        tabIndex={0}
        aria-label="Interactive browser preview"
      >
        {preview?.screenshot ? (
          <img
            src={preview.screenshot}
            alt="Browser preview"
            className="absolute inset-0 h-full w-full select-none object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div>
              {loading ? (
                <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-gray-500" />
              ) : (
                <Globe2 className="mx-auto mb-3 h-7 w-7 text-gray-700" />
              )}
              <p className="text-xs text-gray-500">{startupLabel}</p>
            </div>
          </div>
        )}
        {cursorStyle ? (
          <div
            className="pointer-events-none absolute z-20 -translate-x-[2px] -translate-y-[1px] transition-[left,top] duration-150 ease-out"
            style={cursorStyle}
            data-testid="browser-agent-cursor"
          >
            <span className="absolute -inset-2 rounded-full bg-blue-400/20 blur-md" />
            {preview?.cursor?.action === "click" ? (
              <span
                key={preview.cursor.updatedAt}
                className="browser-agent-click-pulse absolute -left-2 -top-2 h-5 w-5 rounded-full border border-blue-300/80"
                data-testid="browser-agent-click"
              />
            ) : null}
            <MousePointer2 className="relative h-4 w-4 fill-black stroke-[2.5] text-white drop-shadow-[0_0_5px_rgba(96,165,250,0.95)]" />
          </div>
        ) : null}
        {error ? (
          <div className="absolute bottom-2 left-2 right-2 z-30 flex items-center gap-3 rounded-md border border-red-400/20 bg-red-950/95 px-3 py-2 text-[11px] text-red-200 shadow-xl">
            <span className="min-w-0 flex-1">{error}</span>
            <button
              type="button"
              className="shrink-0 rounded-md border border-red-300/20 px-2 py-1 font-medium hover:bg-red-300/10"
              onClick={() => {
                setError(null);
                setPage(null);
                setPreview(null);
                setLoading(true);
                void ensurePage()
                  .then(loadPreview)
                  .catch((reason: unknown) => {
                    setError(
                      reason instanceof Error ? reason.message : "Failed to start browser preview"
                    );
                  })
                  .finally(() => setLoading(false));
              }}
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
