import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Plus, SquareTerminal, Trash2 } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { buildXtermTheme } from "../../pages/ide/xtermTheme";
import { Button } from "@/components/ui/Button";
import { appendApiTokenParam } from "@/lib/auth";
import { fitAndNotifyTerminal, type TerminalDimensions } from "@/lib/terminal-runtime";
import { checkTerminalAccess, enableTerminalAccess } from "@/lib/terminal-access";
import { cn } from "@/lib/utils";

export type IdeTerminalCapability = "checking" | "enabled" | "disabled";

export interface IdeTerminalPanelState {
  capability: IdeTerminalCapability;
  sessionCount: number;
  activeSessionId: string | null;
}

interface TerminalSession {
  id: string;
  ws: WebSocket | null;
  term: XTerminal | null;
  fitAddon: FitAddon | null;
}

export function EmbeddedTerminalPanel({
  workspacePath,
  visible,
  createRequestToken,
  autoCreateOnVisible,
  onStateChange,
}: {
  workspacePath: string;
  visible: boolean;
  createRequestToken: number;
  autoCreateOnVisible: boolean;
  onStateChange?: (state: IdeTerminalPanelState) => void;
}) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [capability, setCapability] = useState<IdeTerminalCapability>("checking");
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [enablingTerminal, setEnablingTerminal] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const activeTermRef = useRef<{
    term: XTerminal;
    fitAddon: FitAddon;
    ws: WebSocket | null;
  } | null>(null);
  const previousCreateRequestRef = useRef<number>(createRequestToken);
  const hasAutoCreatedRef = useRef(false);
  const sessionsRef = useRef<TerminalSession[]>([]);
  const terminalDimensionsRef = useRef<TerminalDimensions | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const applyTheme = () => {
      for (const session of sessionsRef.current) {
        if (session.term) session.term.options.theme = buildXtermTheme("#050508");
      }
    };
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme-mode"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onStateChange?.({
      capability,
      sessionCount: sessions.length,
      activeSessionId,
    });
  }, [activeSessionId, capability, onStateChange, sessions.length]);

  useEffect(() => {
    let cancelled = false;
    const loadCapability = async () => {
      const access = await checkTerminalAccess();
      if (cancelled) return;
      if (access.enabled) {
        setCapability("enabled");
        setTerminalError(null);
        return;
      }
      setCapability("disabled");
      setTerminalError(access.error);
    };
    void loadCapability();
    return () => {
      cancelled = true;
    };
  }, []);

  const enableTerminal = useCallback(async () => {
    setEnablingTerminal(true);
    setTerminalError(null);
    try {
      await enableTerminalAccess();
      const access = await checkTerminalAccess();
      if (access.enabled) {
        setCapability("enabled");
        setTerminalError(null);
      } else {
        setCapability("disabled");
        setTerminalError(access.error);
      }
    } catch (error) {
      setCapability("disabled");
      setTerminalError(error instanceof Error ? error.message : "Failed to enable terminal.");
    } finally {
      setEnablingTerminal(false);
    }
  }, []);

  const fitActiveTerminal = useCallback(() => {
    const active = activeTermRef.current;
    if (!active) return;
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      try {
        terminalDimensionsRef.current = fitAndNotifyTerminal(
          active.term,
          active.fitAddon,
          active.ws,
          terminalDimensionsRef.current
        );
      } catch {
        return;
      }
    });
  }, []);

  const createSession = useCallback(() => {
    if (capability !== "enabled") return;

    const id = crypto.randomUUID().slice(0, 8);
    const term = new XTerminal({
      cursorBlink: true,
      scrollback: 10_000,
      smoothScrollDuration: 0,
      fontSize: 12.5,
      lineHeight: 1.2,
      letterSpacing: 0,
      fontWeight: "400",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Courier New', 'Liberation Mono', monospace",
      theme: buildXtermTheme("#050508"),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsPath = appendApiTokenParam(`/api/terminal/ws?session=${encodeURIComponent(id)}`);
    const ws = new WebSocket(`${wsProto}//${window.location.host}${wsPath}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      term.write("\u001b[32m● Connected\u001b[0m\r\n");
      if (workspacePath && workspacePath !== "~") {
        const escaped = workspacePath.replace(/'/g, "'\\''");
        ws.send(`cd '${escaped}'\n`);
      }
      window.setTimeout(() => {
        fitActiveTerminal();
      }, 40);
    };
    ws.onmessage = (event) => {
      const payload = typeof event.data === "string" ? event.data : new Uint8Array(event.data);
      term.write(payload);
    };
    ws.onclose = () => {
      term.write("\r\n\u001b[31m● Disconnected\u001b[0m\r\n");
    };
    ws.onerror = () => {
      term.write("\r\n\u001b[31m● Connection error\u001b[0m\r\n");
    };

    term.onData((chunk) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });

    const session: TerminalSession = {
      id,
      ws,
      term,
      fitAddon,
    };
    setSessions((previous) => [...previous, session]);
    setActiveSessionId(id);
    setTerminalError(null);
  }, [activeSessionId, capability, fitActiveTerminal, workspacePath]);

  const removeSession = useCallback(
    (id: string) => {
      setSessions((previous) => {
        const session = previous.find((item) => item.id === id);
        if (session) {
          try {
            session.ws?.close();
          } catch {
            // Ignore close errors.
          }
          try {
            session.term?.dispose();
          } catch {
            // Ignore dispose errors.
          }
        }
        const next = previous.filter((item) => item.id !== id);
        if (activeSessionId === id) {
          setActiveSessionId(next[next.length - 1]?.id || null);
        }
        return next;
      });
    },
    [activeSessionId]
  );

  useEffect(() => {
    if (createRequestToken === previousCreateRequestRef.current) return;
    previousCreateRequestRef.current = createRequestToken;
    createSession();
  }, [createRequestToken, createSession]);

  useEffect(() => {
    if (!visible || !autoCreateOnVisible || capability !== "enabled") return;
    if (sessions.length > 0 || hasAutoCreatedRef.current) return;
    hasAutoCreatedRef.current = true;
    createSession();
  }, [autoCreateOnVisible, capability, createSession, sessions.length, visible]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.innerHTML = "";
    activeTermRef.current = null;

    const active = sessions.find((session) => session.id === activeSessionId);
    if (!active?.term || !active.fitAddon) return;
    active.term.open(viewport);
    active.term.focus();
    activeTermRef.current = {
      term: active.term,
      fitAddon: active.fitAddon,
      ws: active.ws,
    };
    terminalDimensionsRef.current = null;
    fitActiveTerminal();
  }, [activeSessionId, fitActiveTerminal, sessions]);

  useEffect(() => {
    if (!visible) return;
    const onResize = () => fitActiveTerminal();
    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(onResize);
    if (viewportRef.current) {
      observer.observe(viewportRef.current);
    }
    window.setTimeout(onResize, 30);
    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    };
  }, [fitActiveTerminal, visible]);

  useEffect(() => {
    return () => {
      for (const session of sessionsRef.current) {
        try {
          session.ws?.close();
        } catch {
          // Ignore close errors.
        }
        try {
          session.term?.dispose();
        } catch {
          // Ignore dispose errors.
        }
      }
    };
  }, []);

  const hasSessions = sessions.length > 0;
  const disabled = capability === "disabled";
  const checking = capability === "checking";
  const panelTitle = useMemo(() => {
    if (checking) return "Checking terminal access...";
    if (disabled) return "Terminal disabled";
    return "Terminal";
  }, [checking, disabled]);

  return (
    <div className="h-full flex flex-col bg-[#050508]">
      <div className="h-8 px-2 border-b border-white/10 bg-black/40 flex items-center gap-1.5">
        <SquareTerminal className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-xs text-gray-400">{panelTitle}</span>
        <div className="flex-1 min-w-0 overflow-x-auto flex items-center gap-1 pl-1">
          {sessions.map((session) => {
            const isActive = activeSessionId === session.id;
            return (
              <button
                key={`terminal-tab:${session.id}`}
                type="button"
                onClick={() => setActiveSessionId(session.id)}
                className={cn(
                  "h-6 px-2 rounded text-[11px] border inline-flex items-center gap-1.5",
                  isActive
                    ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-200"
                    : "border-white/10 text-gray-400 hover:text-gray-200 hover:bg-white/5"
                )}
                title={`Terminal ${session.id}`}
              >
                <span className="truncate max-w-[8rem]">{session.id}</span>
                <span
                  role="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeSession(session.id);
                  }}
                  className="p-0.5 rounded hover:text-red-300"
                  aria-label={`Close terminal ${session.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                </span>
              </button>
            );
          })}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={createSession}
          disabled={disabled || checking}
          className="h-6 px-2 text-xs"
          title="New Terminal"
        >
          <Plus className="w-3.5 h-3.5" />
          New
        </Button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {checking ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500 gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Checking terminal status...</span>
          </div>
        ) : disabled ? (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="max-w-md rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4" />
                <span className="font-medium">Terminal access is disabled</span>
              </div>
              <p className="text-amber-200/90">
                Enable terminal for this gateway when you need shell access from the IDE.
              </p>
              {terminalError && <p className="mt-2 text-amber-100/80">{terminalError}</p>}
              <div className="mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void enableTerminal()}
                  disabled={enablingTerminal}
                  className="h-7 px-2 text-xs"
                >
                  {enablingTerminal ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Enable Web Terminal
                </Button>
              </div>
            </div>
          </div>
        ) : !hasSessions ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              onClick={createSession}
              className="px-3 py-2 rounded border border-white/10 bg-white/5 text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              Start Terminal
            </button>
          </div>
        ) : (
          <div ref={viewportRef} className="absolute inset-0 px-1 py-1 min-h-0" />
        )}
      </div>
    </div>
  );
}

export default EmbeddedTerminalPanel;
