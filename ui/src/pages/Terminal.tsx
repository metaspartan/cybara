import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { SquareTerminal, Plus, Trash2, AlertTriangle } from "lucide-react";
import { appendApiTokenParam, apiFetch } from "@/lib/auth";

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
  const termRef = useRef<HTMLDivElement>(null);
  const activeTermRef = useRef<{ term: XTerminal; fitAddon: FitAddon } | null>(null);

  useEffect(() => {
    apiFetch("/api/terminal/sessions")
      .then((res) => {
        if (res.status === 403) setTerminalEnabled(false);
        else {
          setTerminalEnabled(true);
        }
      })
      .catch(() => setTerminalEnabled(false));
  }, []);

  const createSession = useCallback(() => {
    const id = crypto.randomUUID().slice(0, 8);
    const term = new XTerminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: "#0a0a0f",
        foreground: "#e4e4e7",
        cursor: "#818cf8",
        cursorAccent: "#0a0a0f",
        selectionBackground: "rgba(99, 102, 241, 0.3)",
        black: "#18181b",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e4e4e7",
        brightBlack: "#52525b",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#fafafa",
      },
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
    session.fitAddon.fit();
    session.term.focus();
    activeTermRef.current = { term: session.term, fitAddon: session.fitAddon };
  }, [activeSession, sessions]);

  useEffect(() => {
    const handleResize = () => {
      if (activeTermRef.current?.fitAddon) {
        try {
          activeTermRef.current.fitAddon.fit();
          const session = sessions.find((s) => s.id === activeSession);
          if (session?.ws?.readyState === WebSocket.OPEN && activeTermRef.current.term) {
            const { cols, rows } = activeTermRef.current.term;
            session.ws.send(`\x1b[RESIZE:${cols},${rows}]`);
          }
        } catch {}
      }
    };

    window.addEventListener("resize", handleResize);
    const observer = new ResizeObserver(handleResize);
    if (termRef.current) observer.observe(termRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
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
            The web terminal is disabled by default for security. Start Cybara with the{" "}
            <code className="text-indigo-400">--enable-terminal</code> flag to activate it.
          </p>
          <code className="block bg-white/5 rounded-lg p-3 text-sm text-gray-300 border border-white/10">
            cybara start --enable-terminal
          </code>
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
