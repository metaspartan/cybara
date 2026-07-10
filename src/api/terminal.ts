import { homedir } from "os";
import { existsSync } from "fs";
import { join, win32 } from "path";

export interface TerminalLaunch {
  argv: string[];
}

interface TerminalSession {
  id: string;
  proc: ReturnType<typeof Bun.spawn> | null;
  terminal: Bun.Terminal | null;
  stream: TerminalStreamState;
  createdAt: string;
  lastActivity: number;
}

interface TerminalStreamState {
  decoder: TextDecoder;
  outputListeners: Set<(data: string) => void>;
  exitListeners: Set<() => void>;
  pendingOutput: string;
  exited: boolean;
}

export interface TerminalResize {
  cols: number;
  rows: number;
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
  sessions.delete(id);
  if (session?.proc) {
    try {
      session.proc.kill();
    } catch (error) {
      console.debug("[Terminal] Failed to kill session process:", error);
    }
  }
  if (session?.terminal && !session.terminal.closed) {
    try {
      session.terminal.close();
    } catch (error) {
      console.debug("[Terminal] Failed to close pseudoterminal:", error);
    }
  }
}

const RESIZE_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[RESIZE:(\\d+),(\\d+)\\]`, "g");
const MAX_PENDING_OUTPUT = 64 * 1024;

const TERMINAL_ENV_ALLOWED = new Set([
  "PATH",
  "USER",
  "LOGNAME",
  "LANG",
  "TZ",
  "TMPDIR",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "XPC_SERVICE_NAME",
  "SSH_TTY",
]);

const TERMINAL_ENV_ALLOWED_PREFIX = /^(LC_)/;

const WINDOWS_TERMINAL_ENV_ALLOWED = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "COMSPEC",
  "WINDIR",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "USERNAME",
  "USERDOMAIN",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "COMMONPROGRAMFILES",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PSMODULEPATH",
  "PUBLIC",
  "ALLUSERSPROFILE",
]);

function buildUnixTerminalEnv(shell: string, home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (TERMINAL_ENV_ALLOWED.has(key) || TERMINAL_ENV_ALLOWED_PREFIX.test(key)) {
      env[key] = value;
    }
  }
  return {
    ...env,
    SHELL: shell,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    HOME: home,
  };
}

function buildWindowsTerminalEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (WINDOWS_TERMINAL_ENV_ALLOWED.has(key.toUpperCase())) {
      env[key] = value;
    }
  }
  return {
    ...env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    USERPROFILE: home,
    POWERSHELL_TELEMETRY_OPTOUT: "1",
  };
}

function resolveCommand(value: string | undefined): string | null {
  const command = value?.trim();
  if (!command) return null;
  if (existsSync(command)) return command;
  try {
    return Bun.which(command) ?? null;
  } catch {
    return null;
  }
}

function windowsShellArgv(command: string): string[] {
  const executable = win32.basename(command).toLowerCase();
  return executable === "pwsh" ||
    executable === "pwsh.exe" ||
    executable === "powershell" ||
    executable === "powershell.exe"
    ? [command, "-NoLogo", "-NoProfile"]
    : [command];
}

export function resolveWindowsShellArgv(
  env: NodeJS.ProcessEnv = process.env,
  commandResolver: (value: string | undefined) => string | null = resolveCommand
): string[] {
  const explicit = commandResolver(env.CYBARA_TERMINAL_SHELL);
  if (explicit) return windowsShellArgv(explicit);
  const pwsh = commandResolver("pwsh");
  if (pwsh) return windowsShellArgv(pwsh);
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  const powershell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (existsSync(powershell)) {
    return windowsShellArgv(powershell);
  }
  return [env.COMSPEC || env.ComSpec || "cmd.exe", "/D", "/Q"];
}

export function resolveTerminalLaunch(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  commandResolver: (value: string | undefined) => string | null = resolveCommand
): TerminalLaunch {
  if (platform === "win32") {
    return { argv: resolveWindowsShellArgv(env, commandResolver) };
  }
  return { argv: [env.SHELL || "/bin/sh", "-l"] };
}

export function createTerminalSession(sessionId: string): TerminalSession {
  const home = homedir();
  const launch = resolveTerminalLaunch();
  const isWindows = process.platform === "win32";
  const stream: TerminalStreamState = {
    decoder: new TextDecoder(),
    outputListeners: new Set(),
    exitListeners: new Set(),
    pendingOutput: "",
    exited: false,
  };
  const terminal = new Bun.Terminal({
    cols: 120,
    rows: 30,
    name: "xterm-256color",
    data(_terminal, data) {
      emitTerminalOutput(stream, stream.decoder.decode(data, { stream: true }));
    },
    exit() {
      emitTerminalExit(stream);
    },
  });
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(launch.argv, {
      cwd: home,
      terminal,
      env: isWindows
        ? buildWindowsTerminalEnv(home)
        : buildUnixTerminalEnv(process.env.SHELL || "/bin/sh", home),
    });
  } catch (error) {
    terminal.close();
    throw error;
  }

  const session: TerminalSession = {
    id: sessionId,
    proc,
    terminal,
    stream,
    createdAt: new Date().toISOString(),
    lastActivity: Date.now(),
  };

  sessions.set(sessionId, session);
  proc.exited.then(() => emitTerminalExit(stream)).catch(() => emitTerminalExit(stream));
  return session;
}

export function parseTerminalInput(data: string): {
  payload: string;
  resizes: TerminalResize[];
} {
  const resizes: TerminalResize[] = [];
  const payload = data.replace(RESIZE_SEQUENCE, (_match, colsValue: string, rowsValue: string) => {
    const cols = Number.parseInt(colsValue, 10);
    const rows = Number.parseInt(rowsValue, 10);
    if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
      resizes.push({ cols: Math.min(cols, 1000), rows: Math.min(rows, 1000) });
    }
    return "";
  });
  return { payload, resizes };
}

export function writeToTerminal(session: TerminalSession, data: string): void {
  const terminal = session.terminal;
  if (!terminal || terminal.closed) return;
  const { payload, resizes } = parseTerminalInput(data);
  try {
    for (const resize of resizes) terminal.resize(resize.cols, resize.rows);
    if (payload) terminal.write(payload);
  } catch (error) {
    console.debug("[Terminal] Failed to write pseudoterminal input:", error);
  }
}

function emitTerminalOutput(stream: TerminalStreamState, data: string): void {
  if (!data) return;
  if (stream.outputListeners.size === 0) {
    stream.pendingOutput = `${stream.pendingOutput}${data}`.slice(-MAX_PENDING_OUTPUT);
    return;
  }
  for (const listener of stream.outputListeners) listener(data);
}

function emitTerminalExit(stream: TerminalStreamState): void {
  if (stream.exited) return;
  emitTerminalOutput(stream, stream.decoder.decode());
  stream.exited = true;
  for (const listener of stream.exitListeners) listener();
}

export function startOutputReader(
  session: TerminalSession,
  onData: (data: string) => void,
  onExit: () => void
): void {
  session.stream.outputListeners.add(onData);
  session.stream.exitListeners.add(onExit);
  if (session.stream.pendingOutput) {
    const pending = session.stream.pendingOutput;
    session.stream.pendingOutput = "";
    onData(pending);
  }
  if (session.stream.exited) queueMicrotask(onExit);
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
