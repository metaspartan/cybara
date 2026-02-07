// Web Terminal - PTY WebSocket endpoint
// Requires --enable-terminal flag to activate
import * as pty from "node-pty";
import { homedir } from "os";

interface TerminalSession {
    id: string;
    pty: pty.IPty | null;
    createdAt: string;
    lastActivity: number;
}

const sessions = new Map<string, TerminalSession>();

// Cleanup stale sessions every 5 minutes
setInterval(() => {
    const staleThreshold = Date.now() - 10 * 60 * 1000; // 10 min idle
    for (const [id, session] of sessions) {
        if (session.lastActivity < staleThreshold) {
            killSession(id);
        }
    }
}, 5 * 60 * 1000);

function killSession(id: string) {
    const session = sessions.get(id);
    if (session?.pty) {
        try { session.pty.kill(); } catch { }
    }
    sessions.delete(id);
}

export function createTerminalSession(sessionId: string): TerminalSession {
    const shell = process.env.SHELL || "/bin/bash";
    const home = homedir();

    const ptyProcess = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: home,
        env: {
            ...process.env as Record<string, string>,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            HOME: home,
        },
    });

    const session: TerminalSession = {
        id: sessionId,
        pty: ptyProcess,
        createdAt: new Date().toISOString(),
        lastActivity: Date.now(),
    };

    sessions.set(sessionId, session);
    return session;
}

export function getTerminalSession(sessionId: string): TerminalSession | undefined {
    return sessions.get(sessionId);
}

export function listTerminalSessions(): { id: string; createdAt: string }[] {
    return Array.from(sessions.values()).map(s => ({
        id: s.id,
        createdAt: s.createdAt,
    }));
}

export function destroyTerminalSession(sessionId: string): boolean {
    if (!sessions.has(sessionId)) return false;
    killSession(sessionId);
    return true;
}

export function destroyAllTerminalSessions(): void {
    for (const id of sessions.keys()) {
        killSession(id);
    }
}

export { sessions as terminalSessions };
