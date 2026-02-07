import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { handleRequest } from "./api/routes";
import { config } from "./core/config";
import { channelManager, telegramBot, telegramSessions } from "./core/channels";
import { handleChat } from "./api/chat";
import { providerManager } from "./core/providers";
import { onStatus, addSSEClient, removeSSEClient } from "./core/status";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Detect compiled binary: execPath won't contain 'bun' when compiled
const isCompiledBinary = !process.execPath.endsWith("bun") && !process.execPath.includes("/bun");

// In compiled binaries, __dirname points to virtual filesystem - use executable path
const getUiPath = (): string => {
  if (isCompiledBinary) {
    const execDir = dirname(process.execPath);
    // Check: <exec_dir>/ui/dist (e.g., release/ui/dist)
    const releaseUi = join(execDir, "ui", "dist");
    if (existsSync(releaseUi)) return releaseUi;
    // Tauri macOS: Contents/Resources/_up_/ui/dist (Tauri converts ../ to _up_/)
    const tauriMacUi = join(execDir, "..", "Resources", "_up_", "ui", "dist");
    if (existsSync(tauriMacUi)) return tauriMacUi;
    // Tauri Linux: <exec_dir>/../lib/<app>/ui/dist or <exec_dir>/../share/<app>/ui/dist
    const tauriLinuxLib = join(execDir, "..", "lib", "cybara", "ui", "dist");
    if (existsSync(tauriLinuxLib)) return tauriLinuxLib;
    const tauriLinuxShare = join(execDir, "..", "share", "cybara", "ui", "dist");
    if (existsSync(tauriLinuxShare)) return tauriLinuxShare;
    // Fallback: <exec_dir>/../ui/dist (e.g., release/../ui/dist = ./ui/dist)
    const repoUi = join(execDir, "..", "ui", "dist");
    if (existsSync(repoUi)) return repoUi;
  }
  // Development mode
  return join(__dirname, "..", "ui", "dist");
};

const uiPath = getUiPath();
let uiContent: string;
let uiExists = false;

try {
  uiContent = readFileSync(join(uiPath, "index.html"), "utf-8");
  uiExists = true;
} catch {
  uiContent = `<!DOCTYPE html><html><head><title>Cybara</title></head><body style="font-family: system-ui; background: #0a0a0f; color: #f0f0f5; padding: 40px;"><h1>Cybara</h1><p>UI not built. Run <code>cd ui && bun run build</code> to build the React app.</p></body></html>`;
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
};

const platformConfig = config.getAll();
const PORT = Number(process.env.PORT) || platformConfig.port || 4269;

// Security: default to localhost-only binding
// Use --expose or CYBARA_HOST=0.0.0.0 to allow LAN access
const isExposed = process.argv.includes("--expose") || process.env.CYBARA_HOST === "0.0.0.0";
const HOST = process.env.CYBARA_HOST || platformConfig.host || (isExposed ? "0.0.0.0" : "127.0.0.1");
const TERMINAL_CLI_FLAG = process.argv.includes("--enable-terminal");
function isTerminalEnabled(): boolean {
  return TERMINAL_CLI_FLAG || config.get<boolean>("terminal_enabled") === true;
}

// Log status broadcasts for debugging
onStatus((status) => {
  console.log(`[Status] Event: ${status.status} at ${new Date(status.timestamp).toISOString()}`);
});

// SSE endpoint for status updates with heartbeat
function createStatusStream(): ReadableStream<Uint8Array> {
  let unsubscribe: (() => void) | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;

      // Send initial connection message
      const initMsg = `data: ${JSON.stringify({ status: "idle", timestamp: Date.now() })}\n\n`;
      controller.enqueue(encoder.encode(initMsg));

      // Add to SSE clients
      addSSEClient(controller as any);
      console.log(`[SSE] Client connected`);

      // Set up heartbeat to keep connection alive (every 30 seconds)
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // Connection lost
          cleanup();
        }
      }, 30000);

      // Set up status listener for this client
      unsubscribe = onStatus((status) => {
        try {
          const msg = `data: ${JSON.stringify(status)}\n\n`;
          controller.enqueue(encoder.encode(msg));
        } catch {
          // Client disconnected
          cleanup();
        }
      });

      function cleanup() {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        if (controllerRef) {
          removeSSEClient(controllerRef as any);
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
      }
    },
    cancel() {
      // Client disconnected - cleanup
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      if (controllerRef) {
        removeSSEClient(controllerRef as any);
      }
      if (unsubscribe) {
        unsubscribe();
      }
      console.log(`[SSE] Client disconnected`);
    },
  });
}

import { createTerminalSession, getTerminalSession, destroyTerminalSession, listTerminalSessions, destroyAllTerminalSessions } from "./api/terminal";

interface WsData { sessionId: string }

const server = Bun.serve<WsData>({
  port: PORT,
  hostname: HOST,
  fetch: async (req, server) => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Terminal WebSocket upgrade
    if (pathname === "/api/terminal/ws" && isTerminalEnabled()) {
      const sessionId = url.searchParams.get("session") || crypto.randomUUID();
      const success = server.upgrade(req, { data: { sessionId } });
      if (success) return undefined as any;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Terminal REST endpoints (session management)
    if (pathname.startsWith("/api/terminal") && req.method === "GET") {
      if (!isTerminalEnabled()) {
        return new Response(JSON.stringify({ error: "Terminal disabled. Start with --enable-terminal" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (pathname === "/api/terminal/sessions") {
        return new Response(JSON.stringify(listTerminalSessions()), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // SSE endpoint for status updates
    if (pathname === "/api/sse/status") {
      return new Response(createStatusStream(), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no", // Disable nginx buffering if proxied
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    if (pathname.startsWith("/api/")) {
      let body: unknown;
      if (req.method !== "GET" && req.method !== "HEAD") {
        try {
          body = await req.json();
        } catch {
          body = undefined;
        }
      }
      const response = await handleRequest({
        method: req.method,
        url: req.url,
        headers: Object.fromEntries(req.headers.entries()),
        body,
      });
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "Content-Type": "application/json", ...response.headers },
      });
    }

    // Serve static files from ui/dist directory (Vite build output)
    if (!uiExists) {
      return new Response(uiContent, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // Serve index.html for root and all non-file routes (SPA routing)
    if (pathname === "/" || pathname === "/index.html" || !pathname.includes(".")) {
      return new Response(uiContent, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // Serve other static files (assets, etc.)
    const safePath = pathname.replace(/\.\./g, "").replace(/^\/+/, ""); // Prevent directory traversal
    const filePath = join(uiPath, safePath);

    if (existsSync(filePath) && !filePath.includes(".git")) {
      if (statSync(filePath).isDirectory()) {
        return new Response("Directory listing not allowed", { status: 403 });
      }
      const ext = pathname.substring(pathname.lastIndexOf("."));
      const contentType = mimeTypes[ext] || "application/octet-stream";
      try {
        const content = readFileSync(filePath);
        return new Response(content, {
          headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
        });
      } catch {
        return new Response("File error", { status: 500 });
      }
    }

    // Fallback to index.html for client-side routing
    return new Response(uiContent, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
  websocket: {
    open(ws) {
      const { sessionId } = ws.data as { sessionId: string };
      const session = getTerminalSession(sessionId) || createTerminalSession(sessionId);

      if (session.pty) {
        // node-pty uses onData for output
        session.pty.onData((data: string) => {
          try { ws.send(data); } catch { }
        });
        session.pty.onExit(() => {
          try { ws.close(); } catch { }
          destroyTerminalSession(sessionId);
        });
      }
    },
    message(ws, message) {
      const { sessionId } = ws.data as { sessionId: string };
      const session = getTerminalSession(sessionId);
      if (session?.pty) {
        session.lastActivity = Date.now();
        const data = typeof message === "string" ? message : Buffer.from(message).toString();
        // Handle resize messages
        if (data.startsWith('\x1b[RESIZE:')) {
          const match = data.match(/\x1b\[RESIZE:(\d+),(\d+)\]/);
          if (match) {
            session.pty.resize(parseInt(match[1]), parseInt(match[2]));
            return;
          }
        }
        session.pty.write(data);
      }
    },
    close(ws) {
      const { sessionId } = ws.data as { sessionId: string };
      destroyTerminalSession(sessionId);
    },
  },
});

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   Cybara                                                      ║
║                                                               ║
║   Dashboard:  http://localhost:${PORT}                        ║
║   API:        http://localhost:${PORT}/api                    ║
║   SSE:        http://localhost:${PORT}/api/sse/status         ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);

// Seed default providers
providerManager.seedDefaults();

// Initialize cron scheduler (OpenClaw parity)
import { startScheduler, setAgentHandler, setWakeHandler } from "./core/cron";
import { agentManager } from "./core/agent";

// Set up agent handler for agentTurn jobs - enables agentic cron execution
setAgentHandler(async (job) => {
  const agent = agentManager.list().find(a => a.status === "running");
  if (!agent) return { success: false, error: "No running agent available" };

  try {
    const message = job.payload.kind === "agentTurn" ? job.payload.message : String(job.payload);
    const result = await agentManager.message(agent.id, message);
    console.log(`[Cron] agentTurn job ${job.id} completed: ${result.response.slice(0, 100)}...`);
    return { success: true };
  } catch (error) {
    console.error(`[Cron] agentTurn job ${job.id} failed:`, error);
    return { success: false, error: (error as Error).message };
  }
});

// Set up wake handler for systemEvent jobs
setWakeHandler(async (text) => {
  console.log(`[Cron] Wake event received: ${text}`);
  // System events are logged - can be extended to inject into sessions
});

// Start the scheduler
startScheduler();
console.log("[Cron] Scheduler initialized with agent execution support");

// Initialize task scheduler (UI tasks)
import { taskScheduler } from "./core/scheduler";
taskScheduler.initialize();
console.log("[Task] Scheduler initialized");

// Subscribe to subagent lifecycle events for announcements (OpenClaw parity)
import { onSubagentLifecycle } from "./core/subagent-registry";
import { sendToSession } from "./api/chat";
import type { ChatMessage } from "./api/chat";

onSubagentLifecycle((event) => {
  if (event.type === "announce" && event.data?.message) {
    const sessionKey = event.data.requesterSessionKey as string;
    if (sessionKey) {
      // Inject announcement into requester's session
      const announcement: ChatMessage = {
        role: "assistant",
        content: event.data.message as string,
        timestamp: new Date().toISOString(),
      };
      const injected = sendToSession(sessionKey, announcement);
      if (injected) {
        console.log(`[Subagent] Announced to requester session ${sessionKey.slice(0, 20)}...`);
      }
    }
  }
});
console.log("[Subagent] Lifecycle listener registered");

// Set up Telegram message handler to route to chat
telegramBot.setMessageHandler(async (message, chatId, userId, channelId, fileInfo) => {
  try {
    const storedSessionId = telegramSessions.get(chatId.toString());
    const sessionId = storedSessionId || `telegram:${chatId}`;

    console.log(`[Telegram] Message from chatId=${chatId}, storedSessionId=${storedSessionId}, using sessionId=${sessionId}`);

    // If there's a file, prepend file info to the message
    const fullMessage = fileInfo?.hasFile
      ? `${message}\n\n[File attached: ${fileInfo.filePath}]`
      : message;

    const response = await handleChat({
      message: fullMessage,
      sessionId,
    });
    return response.message.content;
  } catch (error) {
    console.error("[Telegram] Chat handler error:", error);
    return "Sorry, I encountered an error processing your message.";
  }
});

// Auto-setup Telegram if bot token is provided
const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

async function initializeChannels() {
  // First initialize any existing channels from DB
  await channelManager.initializeAll();

  // Auto-setup Telegram if token is available AND channel doesn't exist yet
  if (TELEGRAM_BOT_TOKEN) {
    try {
      // Check if Telegram channel already exists (was initialized above)
      const existingChannels = channelManager.list();
      const hasTelegram = existingChannels.some(c => c.type === "telegram");

      if (hasTelegram) {
        console.log(`[Telegram] Channel already initialized`);
      } else {
        // Only create new channel if none exists
        const channel = await channelManager.setupTelegram(TELEGRAM_BOT_TOKEN, PUBLIC_URL);
        if (channel) {
          console.log(`[Telegram] Auto-configured bot: ${channel.name}`);
          console.log(`[Telegram] Webhook URL: ${PUBLIC_URL}/api/webhooks/telegram/${channel.id}`);
        }
      }
    } catch (error) {
      console.error("[Telegram] Auto-setup failed:", error);
    }
  }

  console.log("[Channels] Initialization complete");
}

initializeChannels().catch((error) => {
  console.error("[Channels] Failed to initialize:", error);
});
