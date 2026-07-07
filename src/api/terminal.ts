import { homedir } from "os";

interface TerminalSession {
  id: string;
  proc: ReturnType<typeof Bun.spawn> | null;
  createdAt: string;
  lastActivity: number;
}

interface TerminalInputSink {
  write: (chunk: string | Uint8Array) => void;
  flush?: () => void;
}

const sessions = new Map<string, TerminalSession>();

setInterval(
  () => {
    const staleThreshold = Date.now() - 10 * 60 * 1000;
    for (const [id, session] of sessions) {
      if (session.lastActivity < staleThreshold) {
        killSession(id);
      }
    }
  },
  5 * 60 * 1000
);

function killSession(id: string) {
  const session = sessions.get(id);
  if (session?.proc) {
    try {
      session.proc.kill();
    } catch (error) {
      console.debug("[Terminal] Failed to kill session process:", error);
    }
  }
  sessions.delete(id);
}

const PTY_SCRIPT = `
import pty, os, sys, select, signal, struct, fcntl, termios

def set_winsize(fd, rows, cols):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    except:
        pass

shell = os.environ.get('SHELL', '/bin/zsh')
master_fd, slave_fd = pty.openpty()
set_winsize(master_fd, 30, 120)

pid = os.fork()
if pid == 0:
    # Child: become session leader, set controlling terminal
    os.setsid()
    fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
    os.dup2(slave_fd, 0)
    os.dup2(slave_fd, 1)
    os.dup2(slave_fd, 2)
    os.close(master_fd)
    os.close(slave_fd)
    os.execlp(shell, shell, '-l')
else:
    # Parent: copy between stdin/stdout and PTY master
    os.close(slave_fd)
    try:
        while True:
            try:
                rfds, _, _ = select.select([sys.stdin.fileno(), master_fd], [], [], 1.0)
            except (select.error, ValueError):
                break
            if sys.stdin.fileno() in rfds:
                data = os.read(sys.stdin.fileno(), 4096)
                if not data:
                    break
                # Check for resize escape sequence
                text = data.decode('utf-8', errors='replace')
                if '\\x1b[RESIZE:' in text:
                    import re
                    m = re.search(r'\\x1b\\[RESIZE:(\\d+),(\\d+)\\]', text)
                    if m:
                        cols, rows = int(m.group(1)), int(m.group(2))
                        set_winsize(master_fd, rows, cols)
                        os.kill(pid, signal.SIGWINCH)
                        # Remove the resize sequence from data, send rest if any
                        text = re.sub(r'\\x1b\\[RESIZE:\\d+,\\d+\\]', '', text)
                        if text:
                            os.write(master_fd, text.encode())
                        continue
                os.write(master_fd, data)
            if master_fd in rfds:
                try:
                    data = os.read(master_fd, 4096)
                except OSError:
                    break
                if not data:
                    break
                os.write(sys.stdout.fileno(), data)
                sys.stdout.flush()
    except OSError:
        pass
    finally:
        os.close(master_fd)
        try:
            os.kill(pid, signal.SIGHUP)
            os.waitpid(pid, 0)
        except:
            pass
`;

const TERMINAL_ENV_SENSITIVE =
  /(key|token|secret|password|passwd|credential|mnemonic|seed|private|apikey|auth)/i;

function buildTerminalEnv(shell: string, home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (TERMINAL_ENV_SENSITIVE.test(key)) continue;
    env[key] = value;
  }
  return {
    ...env,
    SHELL: shell,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    HOME: home,
    PYTHONUNBUFFERED: "1",
  };
}

export function createTerminalSession(sessionId: string): TerminalSession {
  const shell = process.env.SHELL || "/bin/zsh";
  const home = homedir();

  const proc = Bun.spawn(["python3", "-u", "-c", PTY_SCRIPT], {
    cwd: home,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: buildTerminalEnv(shell, home),
  });

  const session: TerminalSession = {
    id: sessionId,
    proc,
    createdAt: new Date().toISOString(),
    lastActivity: Date.now(),
  };

  sessions.set(sessionId, session);
  return session;
}

export function writeToTerminal(session: TerminalSession, data: string): void {
  if (session.proc?.stdin) {
    try {
      const stdin = session.proc.stdin as unknown as TerminalInputSink;
      stdin.write(data);
      stdin.flush?.();
    } catch {
      /* stdin closed */
    }
  }
}

export function startOutputReader(
  session: TerminalSession,
  onData: (data: string) => void,
  onExit: () => void
): void {
  const decoder = new TextDecoder();

  if (session.proc?.stdout) {
    const stdout = session.proc.stdout as ReadableStream<Uint8Array>;
    const reader = stdout.getReader();
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) onData(decoder.decode(value, { stream: true }));
        }
      } catch {
        /* stream closed */
      }
      onExit();
    })();
  } else {
    onExit();
  }

  if (session.proc?.exited) {
    session.proc.exited.then(() => onExit()).catch(() => onExit());
  }
}

export function getTerminalSession(sessionId: string): TerminalSession | undefined {
  return sessions.get(sessionId);
}

export function listTerminalSessions(): { id: string; createdAt: string }[] {
  return Array.from(sessions.values()).map((s) => ({
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
