#!/usr/bin/env bun
import { spawn } from "bun";
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { getAppVersion } from "./core/build-info";
import { resolveCybaraHome } from "./core/cybara-home";
import { installGatewayLogCapture } from "./core/runtime/gateway-log-file";

const CYBARA_DIR = resolveCybaraHome().dir;
const PID_FILE = join(CYBARA_DIR, "cybara.pid");
const LOG_FILE = join(CYBARA_DIR, "cybara.log");
const GATEWAY_LOG_FILE = join(CYBARA_DIR, "logs", "gateway.out.log");

try {
  mkdirSync(CYBARA_DIR, { recursive: true });
} catch (error) {
  console.warn(`[Cybara] Failed to create config directory ${CYBARA_DIR}:`, error);
}

const args = process.argv.slice(2);

function resolveCommand(value?: string): string | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === "--version" || lower === "-v") return "version";
  if (lower === "--help" || lower === "-h") return "help";
  return lower.startsWith("-") ? undefined : lower;
}

function redirectProtocolLogs(): void {
  const redirect = (...values: unknown[]): void => {
    process.stderr.write(`${values.map(String).join(" ")}\n`);
  };
  console.log = redirect;
  console.info = redirect;
  console.debug = redirect;
}

const command = resolveCommand(args[0]);

const CLI_COMMANDS = [
  "status",
  "metrics",
  "doctor",
  "computer-use",
  "computeruse",
  "agents",
  "tasks",
  "skills",
  "plugin",
  "plugins",
  "mcp",
  "lsp",
  "pair",
  "provider",
  "providers",
  "sessions",
  "memory",
  "logs",
  "subagent",
  "subagents",
  "loop",
  "loops",
  "browser",
  "channels",
  "channel",
  "chat",
  "agent",
  "config",
  "update",
  "version",
  "wizard",
  "setup",
  "tui",
  "wallet",
  "router",
  "acp",
  "artifacts",
  "journey",
  "mobile",
  "help",
  "--help",
  "-h",
  "--version",
  "-v",
  "install",
];

const isDaemon = args.includes("-d") || args.includes("--daemon") || args.includes("-bg");
const isDaemonChild = args.includes("--daemon-child");
const isCliCommand = command && CLI_COMMANDS.includes(command);
const isServerStart = !command || command === "start" || command === "server";
const isStop = command === "stop";
const isDaemonLogs = command === "daemon-logs";

function getPid(): number | null {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
      try {
        process.kill(pid, 0);
        return pid;
      } catch {
        try {
          unlinkSync(PID_FILE);
        } catch (error) {
          console.warn(`[Cybara] Failed to remove stale PID file ${PID_FILE}:`, error);
        }
        return null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function logDaemon(message: string) {
  const timestamp = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`);
}

async function startDaemon() {
  const existingPid = getPid();
  if (existingPid) {
    console.log(`Cybara is already running (PID: ${existingPid})`);
    return;
  }

  console.log("Starting Cybara in background...");

  const execPath = process.execPath;

  writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Starting Cybara daemon...\n`);

  const proc = spawn({
    cmd: [execPath, "start", "--daemon-child"],
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });

  writeFileSync(PID_FILE, String(proc.pid));

  await Bun.sleep(1000);

  const stillRunning = getPid();
  if (stillRunning) {
    console.log(`Cybara started in background (PID: ${proc.pid})`);
    console.log(`Dashboard: http://localhost:4269`);
    console.log(`Logs: ${LOG_FILE}`);
    console.log(`\nRun 'cybara stop' to stop the server`);
  } else {
    console.log("Cybara failed to start. Check logs:");
    console.log(`  cybara daemon-logs`);
    if (existsSync(LOG_FILE)) {
      const content = readFileSync(LOG_FILE, "utf-8");
      console.log("\nRecent log output:");
      console.log(content.slice(-500));
    }
  }

  proc.unref();
  process.exit(0);
}

async function stopDaemon() {
  const pid = getPid();
  if (!pid) {
    console.log("Cybara is not running");
    return;
  }

  console.log(`Stopping Cybara (PID: ${pid})...`);
  try {
    process.kill(pid, "SIGTERM");
    try {
      unlinkSync(PID_FILE);
    } catch (error) {
      console.warn(`[Cybara] Failed to remove PID file ${PID_FILE}:`, error);
    }
    console.log("Cybara stopped");
  } catch (e) {
    console.error("Failed to stop Cybara:", e);
  }
}

async function showDaemonLogs() {
  const path = existsSync(GATEWAY_LOG_FILE) ? GATEWAY_LOG_FILE : LOG_FILE;
  if (existsSync(path)) {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n").slice(-50);
    console.log(lines.join("\n"));
  } else {
    console.log("No daemon logs found");
  }
}

async function showHelp() {
  console.log(`
Cybara - AI Agent Platform

Usage:
  cybara                    Start the server on port 4269 (foreground)
  cybara start              Start the server (foreground)
  cybara start -d           Start the server in background (daemon)
  cybara stop               Stop the background server
  cybara status             Show platform status
  cybara metrics            Show token usage and metrics
  cybara doctor             Run environment diagnostics
  cybara update             Download and install the latest CLI release
  cybara version            Show the current version
  cybara agents             List all agents
  cybara chat               Interactive TUI chat
  cybara config             Show / get / set config
  cybara plugin             Plugin management (list, validate, install, remove)
  cybara provider           Provider management (add, update, delete, models)
  cybara sessions           List chat sessions
  cybara memory [query]     List or search memory
  cybara logs [count]       Show system logs from API
  cybara subagent           Subagent management (list, spawn, kill)
  cybara loop               Autonomous loop runs (list, start, show, cancel)
  cybara browser            Browser status and tabs
  cybara channels           List configured channels
  cybara mcp [cmd]          MCP server management
  cybara lsp [cmd]          Language server management
  cybara pair [cmd]         Channel pairing
  cybara wizard             Setup wizard
  cybara daemon-logs        Show daemon process logs
  cybara help               Show full command reference

Options:
  -d, --daemon, -bg         Run server in background
  --expose                  Bind to 0.0.0.0 (allow LAN access)
  --enable-terminal         Enable web terminal access
  --version, -v             Show version
  --help, -h                Show help

Files:
  PID: ${PID_FILE}
  Log: ${GATEWAY_LOG_FILE}
`);
}

async function main() {
  if (command === "version") {
    console.log(`cybara v${getAppVersion()}`);
  } else if (isStop) {
    await stopDaemon();
  } else if (isDaemonLogs) {
    await showDaemonLogs();
  } else if (isServerStart && isDaemon && !isDaemonChild) {
    await startDaemon();
  } else if (isServerStart) {
    const stopGatewayLogCapture = installGatewayLogCapture();
    writeFileSync(PID_FILE, String(process.pid));

    if (isDaemonChild) {
      logDaemon("Daemon child process starting...");
    }

    process.on("SIGINT", () => {
      stopGatewayLogCapture();
      try {
        unlinkSync(PID_FILE);
      } catch (error) {
        logDaemon(`Failed to remove PID file on SIGINT: ${error}`);
      }
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      logDaemon("Received SIGTERM, shutting down...");
      stopGatewayLogCapture();
      try {
        unlinkSync(PID_FILE);
      } catch (error) {
        logDaemon(`Failed to remove PID file on SIGTERM: ${error}`);
      }
      process.exit(0);
    });

    try {
      logDaemon("Loading server module...");
      await import("./index");
    } catch (err) {
      logDaemon(`Failed to start server: ${err}`);
      throw err;
    }
  } else if (command === "acp") {
    redirectProtocolLogs();
    const { runAcpCommand } = await import("./cli/commands/acp");
    await runAcpCommand(args.slice(1));
    await new Promise<void>((resolve) => process.stdout.end(resolve));
    process.exit(0);
  } else if (isCliCommand) {
    await import("./cli/index");
  } else {
    await showHelp();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  logDaemon(`Fatal error: ${err}`);
  process.exit(1);
});
