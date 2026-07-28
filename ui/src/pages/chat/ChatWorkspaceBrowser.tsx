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
  useMemo,
  useRef,
  useState,
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
import {
  BROWSER_PREVIEW_REFRESH_MS,
  BrowserFramePresenter,
  BrowserScrollBatcher,
  decodeBrowserPreviewImage,
  normalizeBrowserWheelDelta,
} from "./browserPreviewInteraction";
import { browserPreviewPollDelay } from "./browserPreviewTiming";
import { BrowserPreviewImage } from "./BrowserPreviewImage";
import { BrowserViewportModeControl } from "./BrowserViewportModeControl";
import {
  type BrowserPreviewStreamInput,
  type BrowserPreviewStreamSender,
} from "./browserPreviewStreamClient";
import {
  BROWSER_VIEWPORT_MODE_STORAGE_KEY,
  BROWSER_VIEWPORT_PRESETS,
  BrowserViewportResizeQueue,
  browserViewportForMode,
  DEFAULT_BROWSER_VIEWPORT,
  inferBrowserViewportMode,
  isBrowserViewportMode,
  parseBrowserViewportMode,
  type BrowserViewport,
  type BrowserViewportMode,
} from "./browserViewportMode";

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

const BROWSER_START_TIMEOUT_MS = 90_000;
const BROWSER_REQUEST_TIMEOUT_MS = 12_000;
const BROWSER_PREVIEW_QUALITY = 78;

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

async function resizeBrowserPage(
  pageId: string,
  viewport: BrowserViewport,
  viewportMode: BrowserViewportMode
): Promise<BrowserViewport> {
  const response = await apiFetch(`/api/browser/tabs/${encodeURIComponent(pageId)}/viewport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...viewport, viewportMode }),
    signal: AbortSignal.timeout(BROWSER_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw await responseError(response, "Browser viewport could not be resized");
  const data: unknown = await response.json();
  const payload =
    data && typeof data === "object" ? (data as { data?: Record<string, unknown> }).data : null;
  return parseBrowserViewport(payload?.viewport) ?? viewport;
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
  const [displayedPreview, setDisplayedPreview] = useState<BrowserPreview | null>(null);
  const [streamFrameVisible, setStreamFrameVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startupLabel, setStartupLabel] = useState("Checking installed browsers");
  const addressRef = useRef<HTMLInputElement>(null);
  const previewSurfaceRef = useRef<HTMLDivElement>(null);
  const requestInFlightRef = useRef(false);
  const queuedFreshPageRef = useRef<BrowserPage | null>(null);
  const pendingPageRef = useRef<PendingBrowserPage | null>(null);
  const lastInteractionAtRef = useRef(Date.now());
  const lastPreviewRefreshAtRef = useRef(0);
  const previewRefreshTimerRef = useRef<number | null>(null);
  const previewRefreshPageRef = useRef<BrowserPage | null>(null);
  const scrollBatcherRef = useRef<BrowserScrollBatcher | null>(null);
  const streamConnectedRef = useRef(false);
  const streamInputRef = useRef<BrowserPreviewStreamSender | null>(null);
  const framePresenterRef = useRef<BrowserFramePresenter<BrowserPreview> | null>(null);
  const viewportResizeQueueRef = useRef<BrowserViewportResizeQueue | null>(null);
  const previewRevisionRef = useRef("");
  const lastNavigationRequestRef = useRef(0);
  const onTitleChangeRef = useRef(onTitleChange);
  const browserViewportRef = useRef(DEFAULT_BROWSER_VIEWPORT);
  const [previewSurfaceSize, setPreviewSurfaceSize] = useState<PreviewSize | null>(null);
  const [viewportMode, setViewportMode] = useState<BrowserViewportMode>(() =>
    parseBrowserViewportMode(
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(BROWSER_VIEWPORT_MODE_STORAGE_KEY)
    )
  );
  const [viewportModeHydratedPageId, setViewportModeHydratedPageId] = useState<string | null>(null);
  const viewportModeRef = useRef(viewportMode);
  const localViewportModeChangeAtRef = useRef(0);
  const browserViewport = useMemo(
    () => browserViewportForMode(viewportMode, previewSurfaceSize),
    [previewSurfaceSize, viewportMode]
  );
  const browserPageId = page?.id ?? null;

  useEffect(() => {
    browserViewportRef.current = browserViewport;
    viewportModeRef.current = viewportMode;
  }, [browserViewport, viewportMode]);

  const selectViewportMode = useCallback((mode: BrowserViewportMode): void => {
    viewportModeRef.current = mode;
    localViewportModeChangeAtRef.current = Date.now();
    setViewportMode(mode);
  }, []);

  const syncRemoteViewportMode = useCallback(
    (value: unknown, viewport: BrowserViewport | null): void => {
      if (!isBrowserViewportMode(value)) return;
      if (
        value !== viewportModeRef.current &&
        Date.now() - localViewportModeChangeAtRef.current < 1_000
      ) {
        return;
      }
      viewportModeRef.current = value;
      browserViewportRef.current =
        value === "responsive"
          ? (viewport ?? DEFAULT_BROWSER_VIEWPORT)
          : BROWSER_VIEWPORT_PRESETS[value];
      setViewportMode((current) => (current === value ? current : value));
    },
    []
  );

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  useEffect(() => {
    window.localStorage.setItem(BROWSER_VIEWPORT_MODE_STORAGE_KEY, viewportMode);
  }, [viewportMode]);

  const clearPreview = useCallback((): void => {
    framePresenterRef.current?.reset();
    setDisplayedPreview(null);
    setPreview(null);
    setStreamFrameVisible(false);
  }, []);

  useEffect(() => {
    const presenter = new BrowserFramePresenter<BrowserPreview>(
      decodeBrowserPreviewImage,
      setDisplayedPreview
    );
    framePresenterRef.current = presenter;
    return () => {
      presenter.dispose();
      if (framePresenterRef.current === presenter) framePresenterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (preview?.screenshot) framePresenterRef.current?.enqueue(preview);
  }, [preview]);

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
    async function loadBrowserPreview(targetPage: BrowserPage, fresh = false): Promise<void> {
      if (requestInFlightRef.current) {
        if (fresh) queuedFreshPageRef.current = targetPage;
        return;
      }
      requestInFlightRef.current = true;
      try {
        const viewport = browserViewportRef.current;
        const query = new URLSearchParams({
          fullPage: "false",
          format: "jpeg",
          quality: String(BROWSER_PREVIEW_QUALITY),
          viewportWidth: String(viewport.width),
          viewportHeight: String(viewport.height),
        });
        if (fresh) query.set("fresh", "true");
        if (!fresh && previewRevisionRef.current) query.set("includePage", "false");
        if (previewRevisionRef.current) query.set("revision", previewRevisionRef.current);
        const response = await apiFetch(
          `/api/browser/tabs/${encodeURIComponent(targetPage.id)}/screenshot?${query}`,
          { signal: AbortSignal.timeout(BROWSER_REQUEST_TIMEOUT_MS) }
        );
        if (response.status === 404) {
          queuedFreshPageRef.current = null;
          const replacement = await createSessionPage(browserSessionId);
          clearPreview();
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
        if (queuedFreshPageRef.current) return;
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
        syncRemoteViewportMode(payload?.viewportMode, nextViewport);
        setViewportModeHydratedPageId(targetPage.id);
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
        const queuedPage = queuedFreshPageRef.current;
        queuedFreshPageRef.current = null;
        if (queuedPage) queueMicrotask(() => void loadBrowserPreview(queuedPage, true));
      }
    },
    [browserSessionId, clearPreview, syncPage, syncRemoteViewportMode]
  );

  const loadBrowserState = useCallback(
    async (targetPage: BrowserPage, includePage = false): Promise<void> => {
      const response = await apiFetch(
        `/api/browser/tabs/${encodeURIComponent(targetPage.id)}/state?includePage=${includePage}`,
        { signal: AbortSignal.timeout(BROWSER_REQUEST_TIMEOUT_MS) }
      );
      if (response.status === 404) {
        streamConnectedRef.current = false;
        const replacement = await createSessionPage(browserSessionId);
        clearPreview();
        previewRevisionRef.current = "";
        syncPage(replacement);
        return;
      }
      if (!response.ok) throw await responseError(response, "Browser state is unavailable");
      const data: unknown = await response.json();
      const payload =
        data && typeof data === "object" ? (data as { data?: Record<string, unknown> }).data : null;
      const nextPage = parseBrowserPage(payload?.page) ?? targetPage;
      const nextCursor = parseBrowserCursor(payload?.cursor);
      const nextViewport = parseBrowserViewport(payload?.viewport);
      syncRemoteViewportMode(payload?.viewportMode, nextViewport);
      setViewportModeHydratedPageId(targetPage.id);
      setPreview((current) => {
        if (!current) return current;
        if (
          sameBrowserCursor(current.cursor, nextCursor) &&
          sameBrowserViewport(current.viewport, nextViewport) &&
          sameBrowserPage(current.page, nextPage)
        ) {
          return current;
        }
        return {
          ...current,
          cursor: nextCursor,
          viewport: nextViewport,
          page: nextPage,
        };
      });
      syncPage(nextPage);
    },
    [browserSessionId, clearPreview, syncPage, syncRemoteViewportMode]
  );

  const schedulePreviewRefresh = useCallback(
    (targetPage: BrowserPage, immediate = false): void => {
      previewRefreshPageRef.current = targetPage;
      if (previewRefreshTimerRef.current !== null && (immediate || !streamConnectedRef.current)) {
        window.clearTimeout(previewRefreshTimerRef.current);
        previewRefreshTimerRef.current = null;
      }
      if (previewRefreshTimerRef.current !== null) return;
      const elapsed = Date.now() - lastPreviewRefreshAtRef.current;
      const delay = immediate ? 0 : Math.max(0, BROWSER_PREVIEW_REFRESH_MS - elapsed);
      previewRefreshTimerRef.current = window.setTimeout(() => {
        previewRefreshTimerRef.current = null;
        const refreshPage = previewRefreshPageRef.current;
        if (!refreshPage) return;
        lastPreviewRefreshAtRef.current = Date.now();
        void loadPreview(refreshPage, true);
      }, delay);
    },
    [loadPreview]
  );

  useEffect(
    () => () => {
      if (previewRefreshTimerRef.current !== null) {
        window.clearTimeout(previewRefreshTimerRef.current);
      }
      previewRefreshTimerRef.current = null;
      previewRefreshPageRef.current = null;
    },
    []
  );

  useEffect(() => {
    const surface = previewSurfaceRef.current;
    if (!surface || typeof ResizeObserver === "undefined") return;
    let timer: number | null = null;
    const updateViewport = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const bounds = surface.getBoundingClientRect();
        setPreviewSurfaceSize((current) =>
          current?.width === bounds.width && current.height === bounds.height
            ? current
            : { width: bounds.width, height: bounds.height }
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
    setViewportModeHydratedPageId((current) => (current === browserPageId ? current : null));
  }, [browserPageId]);

  useEffect(() => {
    viewportResizeQueueRef.current?.dispose();
    viewportResizeQueueRef.current = null;
    if (!visible || !browserPageId) return;
    const queue = new BrowserViewportResizeQueue(
      async (viewport) => {
        const fixedMode = inferBrowserViewportMode(viewport) ?? "responsive";
        return await resizeBrowserPage(browserPageId, viewport, fixedMode);
      },
      (viewport) => {
        setPreview((current) => (current ? { ...current, viewport } : current));
        setError(null);
      },
      (reason) => {
        setError(
          reason instanceof Error ? reason.message : "Browser viewport could not be resized"
        );
      }
    );
    viewportResizeQueueRef.current = queue;
    return () => {
      queue.dispose();
      if (viewportResizeQueueRef.current === queue) viewportResizeQueueRef.current = null;
    };
  }, [browserPageId, visible]);

  useEffect(() => {
    if (!browserPageId || viewportModeHydratedPageId !== browserPageId) return;
    viewportResizeQueueRef.current?.enqueue(browserViewport);
  }, [browserPageId, browserViewport, viewportModeHydratedPageId, visible]);

  useEffect(() => {
    if (!visible) return;
    if (navigationUrl && navigationRequest) return;
    let cancelled = false;
    setLoading(true);
    void ensurePage()
      .then(async (nextPage) => {
        if (cancelled) return;
        await loadBrowserState(nextPage, true);
        if (!cancelled) await loadPreview(nextPage);
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
  }, [ensurePage, loadBrowserState, loadPreview, navigationRequest, navigationUrl, visible]);

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
      if (document.visibilityState === "visible") {
        if (streamConnectedRef.current) {
          await loadBrowserState(page, false).catch(() => undefined);
        } else {
          await loadPreview(page);
        }
      }
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
  }, [loadBrowserState, loadPreview, loading, page, visible]);

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
          if (streamConnectedRef.current) void loadBrowserState(page, true).catch(() => undefined);
          else void loadPreview(page, true);
        }
      },
    });
  }, [loadBrowserState, loadPreview, page, sessionId, visible]);

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
      await loadPreview(nextPage ? { ...nextPage, id: page.id } : page, true);
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
        await loadPreview(resolvedPage, true);
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
    async (targetPage: BrowserPage, input: BrowserPreviewStreamInput, immediateFrame = true) => {
      lastInteractionAtRef.current = Date.now();
      if (streamConnectedRef.current && streamInputRef.current?.(input)) return;
      try {
        const action = input.type === "pointer_click" ? "pointer/click" : input.type;
        const body =
          input.type === "pointer_click"
            ? { x: input.x, y: input.y }
            : input.type === "scroll"
              ? { deltaX: input.deltaX, deltaY: input.deltaY }
              : { key: input.key };
        const response = await apiFetch(
          `/api/browser/tabs/${encodeURIComponent(targetPage.id)}/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!response.ok) throw await responseError(response, "Browser interaction failed");
        if (streamConnectedRef.current) {
          if (immediateFrame) void loadBrowserState(targetPage).catch(() => undefined);
        } else {
          schedulePreviewRefresh(targetPage, immediateFrame);
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Browser interaction failed");
      }
    },
    [loadBrowserState, schedulePreviewRefresh]
  );

  useEffect(() => {
    scrollBatcherRef.current?.dispose();
    if (!page) {
      scrollBatcherRef.current = null;
      return;
    }
    const batcher = new BrowserScrollBatcher(async (delta) => {
      await sendPageInput(page, { type: "scroll", ...delta }, false);
    });
    scrollBatcherRef.current = batcher;
    return () => {
      batcher.dispose();
      if (scrollBatcherRef.current === batcher) scrollBatcherRef.current = null;
    };
  }, [page, sendPageInput]);

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
    void sendPageInput(page, { type: "pointer_click", x: point.x, y: point.y });
  };

  const handlePreviewWheel = useCallback(
    (event: globalThis.WheelEvent): void => {
      event.stopPropagation();
      event.preventDefault();
      if (!page) return;
      lastInteractionAtRef.current = Date.now();
      scrollBatcherRef.current?.enqueue(
        normalizeBrowserWheelDelta(
          event.deltaX,
          event.deltaY,
          event.deltaMode,
          preview?.viewport?.height ?? browserViewport.height
        )
      );
    },
    [browserViewport.height, page, preview?.viewport?.height]
  );

  useEffect(() => {
    const surface = previewSurfaceRef.current;
    if (!surface) return;
    surface.addEventListener("wheel", handlePreviewWheel, { passive: false });
    return () => surface.removeEventListener("wheel", handlePreviewWheel);
  }, [handlePreviewWheel]);

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
    void sendPageInput(page, { type: "keyboard", key });
  };

  const cursorStyle = (() => {
    const cursor = displayedPreview?.cursor;
    const viewport = displayedPreview?.viewport;
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
        <BrowserViewportModeControl mode={viewportMode} onChange={selectViewportMode} />
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
        className="relative min-h-0 flex-1 touch-none cursor-default overflow-hidden overscroll-contain bg-[var(--surface-backdrop)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[rgb(var(--accent-primary))]"
        onClick={handlePreviewClick}
        onKeyDown={handlePreviewKeyDown}
        role="application"
        tabIndex={0}
        aria-label="Interactive browser preview"
        data-browser-viewport-mode={viewportMode}
        data-browser-viewport-width={browserViewport.width}
        data-browser-viewport-height={browserViewport.height}
      >
        <BrowserPreviewImage
          pageId={page?.id ?? null}
          visible={visible}
          fallbackSource={displayedPreview?.screenshot ?? null}
          quality={BROWSER_PREVIEW_QUALITY}
          inputSenderRef={streamInputRef}
          onConnectionChange={(connected) => {
            streamConnectedRef.current = connected;
            if (!connected && page) schedulePreviewRefresh(page, true);
          }}
          onFramePresented={setStreamFrameVisible}
          onStreamError={setError}
        />
        {!displayedPreview?.screenshot && !streamFrameVisible ? (
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
        ) : null}
        {cursorStyle ? (
          <div
            className="pointer-events-none absolute z-20 -translate-x-[2px] -translate-y-[1px] transition-[left,top] duration-150 ease-out"
            style={cursorStyle}
            data-testid="browser-agent-cursor"
          >
            <span className="absolute -inset-2 rounded-full bg-blue-400/20 blur-md" />
            {displayedPreview.cursor?.action === "click" ? (
              <span
                key={displayedPreview.cursor.updatedAt}
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
                clearPreview();
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
