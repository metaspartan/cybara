#!/usr/bin/env bun
/**
 * Cybara - Unified Entry Point
 *
 * This file serves as the single entry point for the compiled binary.
 * It routes to either the CLI/TUI or starts the server based on arguments.
 *
 * Usage:
 *   cybara              - Start the server (default)
 *   cybara start        - Start the server (foreground)
 *   cybara start -d     - Start the server (daemon/background)
 *   cybara stop         - Stop the daemon
 *   cybara status       - Show status (CLI)
 *   cybara agents       - List agents (CLI)
 *   cybara mcp [cmd]    - MCP commands (CLI)
 *   cybara help         - Show help
 *   cybara --version    - Show version
 */

import { spawn } from "bun";
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync, openSync, closeSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Use home directory for state files since __dirname is virtual in compiled binaries
const CYBARA_DIR = join(homedir(), ".cybara");
const PID_FILE = join(CYBARA_DIR, "cybara.pid");
const LOG_FILE = join(CYBARA_DIR, "cybara.log");

// Ensure .cybara directory exists
try { mkdirSync(CYBARA_DIR, { recursive: true }); } catch { }

const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();

// Commands that should use CLI mode
const CLI_COMMANDS = [
    "status",
    "metrics",
    "agents",
    "tasks",
    "skills",
    "mcp",
    "help",
    "--help",
    "-h",
    "--version",
    "-v",
    "install",
];

// Check flags
const isDaemon = args.includes("-d") || args.includes("--daemon") || args.includes("-bg");
const isDaemonChild = args.includes("--daemon-child");
const isCliCommand = command && CLI_COMMANDS.includes(command);
const isServerStart = !command || command === "start" || command === "server";
const isStop = command === "stop";
const isLogs = command === "logs";

function getPid(): number | null {
    try {
        if (existsSync(PID_FILE)) {
            const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
            // Check if process is actually running
            try {
                process.kill(pid, 0);
                return pid;
            } catch {
                // Process not running, clean up stale PID file
                try { unlinkSync(PID_FILE); } catch { }
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

    // Get the path to this executable
    const execPath = process.argv[0];

    // Clear old log file
    writeFileSync(LOG_FILE, `[${new Date().toISOString()}] Starting Cybara daemon...\n`);

    // Spawn detached process - use 'ignore' for stdio and let child process handle logging
    const proc = spawn({
        cmd: [execPath, "start", "--daemon-child"],
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
    });

    // Write PID file
    writeFileSync(PID_FILE, String(proc.pid));

    // Wait a moment to check if it actually started
    await Bun.sleep(1000);

    // Check if process is still running
    const stillRunning = getPid();
    if (stillRunning) {
        console.log(`Cybara started in background (PID: ${proc.pid})`);
        console.log(`Dashboard: http://localhost:4269`);
        console.log(`Logs: ${LOG_FILE}`);
        console.log(`\nRun 'cybara stop' to stop the server`);
    } else {
        console.log("Cybara failed to start. Check logs:");
        console.log(`  cybara logs`);
        // Show last few lines of log
        if (existsSync(LOG_FILE)) {
            const content = readFileSync(LOG_FILE, "utf-8");
            console.log("\nRecent log output:");
            console.log(content.slice(-500));
        }
    }

    // Unref so this process can exit
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
        try { unlinkSync(PID_FILE); } catch { }
        console.log("Cybara stopped");
    } catch (e) {
        console.error("Failed to stop Cybara:", e);
    }
}

async function showLogs() {
    if (existsSync(LOG_FILE)) {
        const content = readFileSync(LOG_FILE, "utf-8");
        const lines = content.split("\n").slice(-50);
        console.log(lines.join("\n"));
    } else {
        console.log("No logs found");
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
  cybara logs               Show daemon logs
  cybara status             Show platform status
  cybara agents             List all agents
  cybara mcp list           List MCP servers
  cybara mcp search <q>     Search MCP registry
  cybara mcp install <pkg>  Install MCP server
  cybara mcp popular        Show popular MCP servers
  cybara help               Show this help

Options:
  -d, --daemon, -bg         Run server in background
  --version, -v             Show version
  --help, -h                Show help

Files:
  PID: ${PID_FILE}
  Log: ${LOG_FILE}
`);
}

async function main() {
    if (isStop) {
        await stopDaemon();
    } else if (isLogs) {
        await showLogs();
    } else if (isServerStart && isDaemon && !isDaemonChild) {
        await startDaemon();
    } else if (isServerStart) {
        // Write PID for foreground mode too
        writeFileSync(PID_FILE, String(process.pid));

        // Log startup for daemon mode
        if (isDaemonChild) {
            logDaemon("Daemon child process starting...");
        }

        // Cleanup on exit
        process.on("SIGINT", () => {
            try { unlinkSync(PID_FILE); } catch { }
            process.exit(0);
        });
        process.on("SIGTERM", () => {
            logDaemon("Received SIGTERM, shutting down...");
            try { unlinkSync(PID_FILE); } catch { }
            process.exit(0);
        });

        // Start the server (imports at runtime to avoid loading everything for CLI)
        try {
            logDaemon("Loading server module...");
            await import("./index");
        } catch (err) {
            logDaemon(`Failed to start server: ${err}`);
            throw err;
        }
    } else if (isCliCommand) {
        // Run CLI command
        await import("./cli");
    } else {
        await showHelp();
    }
}

main().catch((err) => {
    console.error("Fatal error:", err);
    logDaemon(`Fatal error: ${err}`);
    process.exit(1);
});
