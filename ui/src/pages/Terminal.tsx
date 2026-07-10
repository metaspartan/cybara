import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { SquareTerminal, Plus, Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { buildXtermTheme } from "./ide/xtermTheme";
import { appendApiTokenParam } from "@/lib/auth";
import { checkTerminalAccess, enableTerminalAccess } from "@/lib/terminal-access";
import { fitAndNotifyTerminal, type TerminalDimensions } from "@/lib/terminal-runtime";

interface TermSession {
  id: string;
  ws: WebSocket | null;
  term: XTerminal | null;
  fitAddon: FitAddon | null;
}

export function TerminalPage() {
  const [sessions, setSessions] = useState<TermSession[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [terminalEnabled, setTerminalEnabled] = useState<boolean | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [enablingTerminal, setEnablingTerminal] = useState(false);
  const termRef = useRef<HTMLDivElement>(null);
  const activeTermRef = useRef<{ term: XTerminal; fitAddon: FitAddon } | null>(null);
  // Mirror of `sessions` so the unmount cleanup can reach the latest set without
  // re-subscribing (a []-dep cleanup would otherwise capture an empty array).
  const sessionsRef = useRef<TermSession[]>([]);
  const terminalDimensionsRef = useRef<TerminalDimensions | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const applyTheme = () => {
      for (const session of sessionsRef.current) {
        if (session.term) session.term.options.theme = buildXtermTheme("#0a0a0f");
      }
    };
    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme-mode"],
    });
    return () => observer.disconnect();
  }, []);

  // Close every socket and dispose every terminal when leaving the page.
  // Without this, navigating away from /terminal leaked one open WebSocket and
  // one undisposed xterm instance per session for the life of the tab.
  useEffect(() => {
    return () => {
      for (const session of sessionsRef.current) {
        try {
          session.ws?.close();
        } catch {}
        try {
          session.term?.dispose();
        } catch {}
      }
    };
  }, []);

  const refreshTerminalAccess = useCallback(async () => {
    const access = await checkTerminalAccess();
    setTerminalEnabled(access.enabled);
    setTerminalError(access.enabled ? null : access.error);
    return access;
  }, []);

  useEffect(() => {
    void refreshTerminalAccess();
  }, [refreshTerminalAccess]);

  const enableTerminal = useCallback(async () => {
    setEnablingTerminal(true);
    setTerminalError(null);
    try {
      await enableTerminalAccess();
      const access = await refreshTerminalAccess();
      if (!access.enabled) {
        setTerminalError(access.error);
      }
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : "Failed to enable terminal.");
      setTerminalEnabled(false);
    } finally {
      setEnablingTerminal(false);
    }
  }, [refreshTerminalAccess]);

  const createSession = useCallback(() => {
    const id = crypto.randomUUID().slice(0, 8);
    const term = new XTerminal({
      cursorBlink: true,
      scrollback: 10_000,
      smoothScrollDuration: 0,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: buildXtermTheme("#0a0a0f"),
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsPath = appendApiTokenParam(`/api/terminal/ws?session=${encodeURIComponent(id)}`);
    const ws = new WebSocket(`${proto}//${window.location.host}${wsPath}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      term.write("\x1b[32m● Connected\x1b[0m\r\n");
    };

    ws.onmessage = (e) => {
      const data = typeof e.data === "string" ? e.data : new Uint8Array(e.data);
      term.write(data);
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[31m● Disconnected\x1b[0m\r\n");
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const session: TermSession = { id, ws, term, fitAddon };
    setSessions((prev) => [...prev, session]);
    setActiveSession(id);
  }, []);

  const removeSession = useCallback((id: string) => {
    setSessions((prev) => {
      const session = prev.find((s) => s.id === id);
      if (session) {
        session.ws?.close();
        session.term?.dispose();
      }
      return prev.filter((s) => s.id !== id);
    });
    setActiveSession((prev) => (prev === id ? null : prev));
  }, []);

  useEffect(() => {
    const container = termRef.current;
    if (!container) return;

    container.innerHTML = "";
    activeTermRef.current = null;

    const session = sessions.find((s) => s.id === activeSession);
    if (!session?.term || !session.fitAddon) return;

    session.term.open(container);
    session.term.focus();
    activeTermRef.current = { term: session.term, fitAddon: session.fitAddon };
    terminalDimensionsRef.current = null;
  }, [activeSession, sessions]);

  useEffect(() => {
    const handleResize = () => {
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        const active = activeTermRef.current;
        const session = sessions.find((item) => item.id === activeSession);
        if (!active) return;
        try {
          terminalDimensionsRef.current = fitAndNotifyTerminal(
            active.term,
            active.fitAddon,
            session?.ws ?? null,
            terminalDimensionsRef.current
          );
        } catch {
          return;
        }
      });
    };

    window.addEventListener("resize", handleResize);
    const observer = new ResizeObserver(handleResize);
    if (termRef.current) observer.observe(termRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    };
  }, [activeSession, sessions]);

  useEffect(() => {
    if (terminalEnabled && sessions.length === 0) {
      createSession();
    }
  }, [terminalEnabled, sessions.length, createSession]);

  if (terminalEnabled === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0a0f]">
        <div className="text-gray-400">Checking terminal status...</div>
      </div>
    );
  }

  if (!terminalEnabled) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0a0a0f]">
        <div className="text-center max-w-md">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Terminal Disabled</h2>
          <p className="text-gray-400 mb-4">
            The web terminal is disabled by default for security. Enable it for this gateway when
            you need shell access.
          </p>
          {terminalError && (
            <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              {terminalError}
            </p>
          )}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void enableTerminal()}
              disabled={enablingTerminal}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-indigo-400/40 bg-indigo-500/20 px-4 text-sm font-medium text-indigo-100 transition-colors hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {enablingTerminal ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SquareTerminal className="h-4 w-4" />
              )}
              Enable Web Terminal
            </button>
            <a
              href="/settings?section=safety"
              className="text-sm text-gray-400 hover:text-gray-200"
            >
              Open Safety Settings
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0f]">
      <div className="flex items-center gap-1 px-3 py-2 bg-white/[0.02] border-b border-white/10">
        <SquareTerminal className="w-4 h-4 text-gray-500 mr-2" />
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSession(s.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeSession === s.id
                ? "bg-white/10 text-white border border-white/20"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
            }`}
          >
            <span>Terminal {s.id}</span>
            <span
              onClick={(e) => {
                e.stopPropagation();
                removeSession(s.id);
              }}
              className="hover:text-red-400 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
            </span>
          </button>
        ))}
        <button
          onClick={createSession}
          className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
          title="New terminal"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div ref={termRef} className="flex-1 p-1" style={{ minHeight: 0 }} />
    </div>
  );
}
