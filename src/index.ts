import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { agentManager } from "./core/agent";
import { handleChat, listSessions, sendToSession, type ChatMessage } from "./api/chat";
import { handleRequest } from "./api/routes";
import {
  createTerminalSession,
  getTerminalSession,
  destroyTerminalSession,
  listTerminalSessions,
  writeToTerminal,
  startOutputReader,
} from "./api/terminal";
import { config } from "./core/config";
import { startScheduler, setAgentHandler, setWakeHandler } from "./core/cron";
import { setChannelSubagentSpawnHandler } from "./core/channels/commands";
import { configureChannelChatRuntime } from "./core/channels/chat-runtime";
import {
  channelManager,
  telegramBot,
  telegramSessions,
  discordAdapter,
  slackAdapter,
  signalAdapter,
  whatsappAdapter,
  imessageAdapter,
  matrixAdapter,
  mattermostAdapter,
  ircAdapter,
  ntfyAdapter,
  twitchAdapter,
  lineAdapter,
  googleChatAdapter,
  msTeamsAdapter,
  feishuAdapter,
  dingtalkAdapter,
  wecomAdapter,
  homeAssistantAdapter,
  zulipAdapter,
  synologyAdapter,
  nextcloudAdapter,
  zaloAdapter,
  type MessageHandlerFileInfo,
} from "./core/channels";
import { handleSessionsSpawn } from "./core/tools/handlers/channel";
import {
  handleMemoryContext,
  handleMemoryList,
  handleMemorySearch,
} from "./core/tools/handlers/memory";
import { toolSchemas } from "./core/tools/index";
import { providerManager } from "./core/providers";
import { taskScheduler } from "./core/scheduler";
import {
  onStatus,
  addSSEClient,
  removeSSEClient,
  onStatusStream,
  createStatusSnapshotEvent,
} from "./core/status";
import { logSandboxRuntimeStatus } from "./core/sandbox";
import { onSubagentLifecycle } from "./core/subagent-registry";
import { resolveUiPath } from "./core/runtime/ui-path";
import { readUiIndexContent } from "./core/runtime/ui-index";
import { getGatewayBasePath, revealGatewayApiKey, securityCheck } from "./api/security";
import { getClientIp } from "./api/client-ip";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isCompiledBinary = !process.execPath.endsWith("bun") && !process.execPath.includes("/bun");

function discoverUiPath(): string {
  const firstCandidate = resolveUiPath({
    isCompiledBinary,
    execPath: process.execPath,
    moduleDir: __dirname,
    appName: "cybara",
    existsSyncFn: existsSync,
  });

  const candidates = new Set<string>([firstCandidate]);
  const bases = [dirname(process.execPath), process.cwd(), __dirname];
  if (process.env.CYBARA_RESOURCE_DIR) {
    bases.unshift(process.env.CYBARA_RESOURCE_DIR);
  }

  for (const base of bases) {
    let current = base;
    for (let i = 0; i < 7; i++) {
      candidates.add(join(current, "ui", "dist"));
      candidates.add(join(current, "dist", "ui", "dist"));
      candidates.add(join(current, "src-tauri", "bin", "ui", "dist"));
      current = join(current, "..");
    }
  }

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "index.html"))) {
      return candidate;
    }
  }

  return firstCandidate;
}

const uiPath = discoverUiPath();
let uiContent: string;
let uiExists = false;

try {
  uiContent = readFileSync(join(uiPath, "index.html"), "utf-8");
  uiExists = true;
  console.log(`[UI] Serving UI from: ${uiPath}`);
} catch {
  console.error(
    `[UI] Failed to load UI index at ${join(uiPath, "index.html")} (execPath=${process.execPath}, cwd=${process.cwd()})`
  );
  uiContent = `<!DOCTYPE html><html><head><title>Cybara</title></head><body style="font-family: system-ui; background: #0a0a0f; color: #f0f0f5; padding: 40px;"><h1>Cybara</h1><p>UI not built. Run <code>cd ui && bun run build</code> to build the React app.</p></body></html>`;
}

function readUiIndex(): string {
  const raw = readUiIndexContent({ uiPath, uiExists, fallbackContent: uiContent });
  const basePath = getGatewayBasePath();
  if (!basePath) return raw;
  // The Vite build emits root-absolute asset URLs; rewrite them under the
  // configured prefix and tell the SPA its base so routing/fetches line up.
  return raw
    .replaceAll('src="/', `src="${basePath}/`)
    .replaceAll('href="/', `href="${basePath}/`)
    .replace(
      "<head>",
      // A meta tag (not an inline script) so the strict CSP needs no carve-out.
      `<head><meta name="cybara-base-path" content="${basePath}">`
    );
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
  ".map": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
};

function cacheControlForStaticAsset(ext: string): string {
  if (ext === ".js" || ext === ".mjs" || ext === ".css") {
    return "no-cache";
  }
  if (ext === ".map") {
    return "no-store";
  }
  return "public, max-age=3600";
}

const commonSecurityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

const platformConfig = config.getAll();
const PORT = Number(process.env.PORT) || platformConfig.port || 4269;

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' http://127.0.0.1:${PORT} http://localhost:${PORT} ws://127.0.0.1:${PORT} ws://localhost:${PORT}`,
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const htmlHeaders = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-cache",
  "Content-Security-Policy": contentSecurityPolicy,
  ...commonSecurityHeaders,
};

function isFileLikePath(pathname: string): boolean {
  return /\.[^/]+$/.test(pathname);
}

const isExposeFlagSet = process.argv.includes("--expose");
function isAllInterfaceHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

const configuredHost =
  typeof platformConfig.host === "string" && platformConfig.host.trim()
    ? platformConfig.host.trim()
    : "127.0.0.1";
const HOST =
  process.env.CYBARA_HOST ||
  (isExposeFlagSet
    ? "0.0.0.0"
    : isAllInterfaceHost(configuredHost)
      ? "127.0.0.1"
      : configuredHost) ||
  "127.0.0.1";
const TERMINAL_CLI_FLAG = process.argv.includes("--enable-terminal");
function isTerminalEnabled(): boolean {
  return TERMINAL_CLI_FLAG || config.get<boolean>("terminal_enabled") === true;
}

logSandboxRuntimeStatus("server_start");

onStatus((status) => {
  console.log(`[Status] Event: ${status.status} at ${new Date(status.timestamp).toISOString()}`);
});

function createStatusStream(): ReadableStream<Uint8Array> {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;

      const initMsg = `data: ${JSON.stringify(createStatusSnapshotEvent())}\n\n`;
      controller.enqueue(encoder.encode(initMsg));

      addSSEClient(controller);
      console.log(`[SSE] Client connected`);

      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          cleanup();
        }
      }, 30000);

      function cleanup() {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        if (controllerRef) {
          removeSSEClient(controllerRef);
        }
      }
    },
    cancel() {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      if (controllerRef) {
        removeSSEClient(controllerRef);
      }
      console.log(`[SSE] Client disconnected`);
    },
  });
}

type WsData =
  | {
      kind: "terminal";
      sessionId: string;
    }
  | {
      kind: "status";
      unsubscribe?: () => void;
    };

function withOptionalQueryToken(headers: Record<string, string>, url: URL): Record<string, string> {
  // Query-token auth exists only for browser WebSocket/EventSource clients,
  // which cannot set an Authorization header. Honor it solely on upgrade/SSE
  // requests (never overriding a real header) so tokens stay out of ordinary
  // request URLs, where they would leak into proxy logs and browser history.
  const connection = (headers.connection || headers.Connection || "").toLowerCase();
  const accept = headers.accept || headers.Accept || "";
  const isBrowserStreamClient =
    connection.includes("upgrade") || accept.includes("text/event-stream");
  if (!isBrowserStreamClient) return headers;

  const token = url.searchParams.get("token") || url.searchParams.get("api_key");
  if (!token) return headers;

  if (!headers.authorization && !headers.Authorization) {
    return { ...headers, authorization: token };
  }

  return headers;
}

Bun.serve<WsData>({
  port: PORT,
  hostname: HOST,
  idleTimeout: 255,
  fetch: async (req, server) => {
    const url = new URL(req.url);
    let pathname = url.pathname;

    // Optional URL prefix (Settings > Auth): strip it once here so every
    // route below stays prefix-agnostic. Health stays reachable unprefixed —
    // supervisors (sidecars, scripts, load balancers) probe it directly.
    const basePath = getGatewayBasePath();
    if (basePath) {
      if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
        pathname = pathname.slice(basePath.length) || "/";
      } else if (pathname === "/" || pathname === "/index.html") {
        return Response.redirect(`${basePath}/`, 307);
      } else if (!pathname.startsWith("/api/health")) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const requestHeaders = Object.fromEntries(req.headers.entries());
    const directIp = server.requestIP?.(req)?.address;
    const clientIp = getClientIp(requestHeaders, directIp);

    if (pathname.startsWith("/api/terminal")) {
      const terminalHeaders = withOptionalQueryToken(requestHeaders, url);
      const security = securityCheck(req.method, pathname, terminalHeaders, clientIp);
      if (!security.passed) {
        return new Response(JSON.stringify({ error: security.error }), {
          status: security.statusCode || 403,
          headers: {
            "Content-Type": "application/json",
            ...commonSecurityHeaders,
            ...security.headers,
          },
        });
      }

      if (!isTerminalEnabled()) {
        return new Response(
          JSON.stringify({ error: "Terminal disabled. Start with --enable-terminal" }),
          {
            status: 403,
            headers: {
              "Content-Type": "application/json",
              ...commonSecurityHeaders,
              ...security.headers,
            },
          }
        );
      }

      if (pathname === "/api/terminal/ws") {
        const sessionId = url.searchParams.get("session") || crypto.randomUUID();
        const success = server.upgrade(req, { data: { kind: "terminal", sessionId } });
        if (success) return undefined;
        return new Response("WebSocket upgrade failed", {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...commonSecurityHeaders },
        });
      }

      if (pathname === "/api/terminal/sessions") {
        return new Response(JSON.stringify(listTerminalSessions()), {
          headers: {
            "Content-Type": "application/json",
            ...commonSecurityHeaders,
            ...security.headers,
          },
        });
      }
    }

    if (pathname === "/api/ws/status") {
      const statusHeaders = withOptionalQueryToken(requestHeaders, url);
      const security = securityCheck(req.method, pathname, statusHeaders, clientIp);
      if (!security.passed) {
        return new Response(JSON.stringify({ error: security.error }), {
          status: security.statusCode || 403,
          headers: {
            "Content-Type": "application/json",
            ...commonSecurityHeaders,
            ...security.headers,
          },
        });
      }

      const success = server.upgrade(req, { data: { kind: "status" } });
      if (success) return undefined;
      return new Response("WebSocket upgrade failed", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...commonSecurityHeaders },
      });
    }

    if (pathname === "/api/sse/status") {
      const sseHeaders = withOptionalQueryToken(requestHeaders, url);
      const security = securityCheck(req.method, pathname, sseHeaders, clientIp);
      if (!security.passed) {
        return new Response(JSON.stringify({ error: security.error }), {
          status: security.statusCode || 403,
          headers: {
            "Content-Type": "application/json",
            ...commonSecurityHeaders,
            ...security.headers,
          },
        });
      }

      return new Response(createStatusStream(), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          ...commonSecurityHeaders,
          ...security.headers,
        },
      });
    }

    if (pathname.startsWith("/api/")) {
      let body: unknown;
      let rawBody: string | undefined;
      let malformedBody = false;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const needsRaw = pathname.endsWith("/webhook") || pathname.includes("/webhooks/");
        let text = "";
        try {
          text = await req.text();
        } catch {
          text = "";
        }
        if (needsRaw) rawBody = text;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = undefined;
            malformedBody = !needsRaw;
          }
        }
      }
      if (malformedBody) {
        return new Response(
          JSON.stringify({ error: "Invalid JSON body", code: "VALIDATION_ERROR", path: pathname }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...commonSecurityHeaders },
          }
        );
      }
      const response = await handleRequest({
        method: req.method,
        // Route matching re-parses the URL, so hand it the prefix-stripped path.
        url: basePath ? `${url.origin}${pathname}${url.search}` : req.url,
        headers: requestHeaders,
        body,
        rawBody,
        ip: clientIp,
      });
      return new Response(
        response.raw ? String(response.body ?? "") : JSON.stringify(response.body),
        {
          status: response.status,
          headers: {
            "Content-Type": "application/json",
            ...commonSecurityHeaders,
            ...response.headers,
          },
        }
      );
    }

    const fileLikePath = isFileLikePath(pathname);

    if (!uiExists) {
      if (pathname === "/" || pathname === "/index.html" || !fileLikePath) {
        return new Response(readUiIndex(), { headers: htmlHeaders });
      }
      return new Response("Static asset not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...commonSecurityHeaders },
      });
    }

    if (pathname === "/" || pathname === "/index.html" || !fileLikePath) {
      return new Response(readUiIndex(), { headers: htmlHeaders });
    }

    const safePath = pathname.replace(/\.\./g, "").replace(/^\/+/, ""); // Prevent directory traversal
    const filePath = join(uiPath, safePath);

    if (existsSync(filePath) && !filePath.includes(".git")) {
      if (statSync(filePath).isDirectory()) {
        return new Response("Directory listing not allowed", {
          status: 403,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...commonSecurityHeaders },
        });
      }
      const ext = pathname.substring(pathname.lastIndexOf("."));
      const contentType = mimeTypes[ext] || "application/octet-stream";
      try {
        const content = readFileSync(filePath);
        return new Response(content, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": cacheControlForStaticAsset(ext),
            ...commonSecurityHeaders,
          },
        });
      } catch {
        return new Response("File error", {
          status: 500,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...commonSecurityHeaders },
        });
      }
    }

    if (fileLikePath) {
      return new Response("Static asset not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...commonSecurityHeaders },
      });
    }

    return new Response(uiContent, { headers: htmlHeaders });
  },
  websocket: {
    open(ws) {
      const data = ws.data as WsData;
      if (data.kind === "status") {
        try {
          ws.send(JSON.stringify(createStatusSnapshotEvent()));
          const unsubscribe = onStatusStream((event) => {
            try {
              ws.send(JSON.stringify(event));
            } catch {
              // Connection will be cleaned up in close handler
            }
          });
          data.unsubscribe = unsubscribe;
        } catch (error) {
          console.debug("[Status WS] Failed to initialize websocket:", error);
          try {
            ws.close();
          } catch {
            // ignore
          }
        }
        return;
      }

      const { sessionId } = data;
      const session = getTerminalSession(sessionId) || createTerminalSession(sessionId);

      startOutputReader(
        session,
        (output: string) => {
          try {
            ws.send(output);
          } catch (error) {
            console.debug("[Terminal] Failed to send websocket data:", error);
          }
        },
        () => {
          try {
            ws.close();
          } catch (error) {
            console.debug("[Terminal] Failed to close websocket:", error);
          }
          destroyTerminalSession(sessionId);
        }
      );
    },
    message(ws, message) {
      const data = ws.data as WsData;
      if (data.kind === "status") {
        const text = typeof message === "string" ? message : Buffer.from(message).toString();
        if (text === "ping") {
          try {
            ws.send("pong");
          } catch {
            // ignore
          }
        }
        return;
      }

      const session = getTerminalSession(data.sessionId);
      if (session) {
        session.lastActivity = Date.now();
        const input = typeof message === "string" ? message : Buffer.from(message).toString();
        writeToTerminal(session, input);
      }
    },
    close(ws) {
      const data = ws.data as WsData;
      if (data.kind === "status") {
        data.unsubscribe?.();
        return;
      }
      destroyTerminalSession(data.sessionId);
    },
  },
});

// Eagerly materialize the gateway API key so onboarding always has one on
// first boot (instead of lazily on the first authenticated request). The key
// lives at ~/.cybara/api_key and survives app updates; only an explicit
// rotation replaces it. The tokenized dashboard URL below authenticates the
// browser even when the localhost bypass is off — same pattern as Jupyter.
const gatewayKey = revealGatewayApiKey().apiKey;
const startupBasePath = getGatewayBasePath();
const tokenizedDashboardUrl = gatewayKey
  ? `http://localhost:${PORT}${startupBasePath}/?token=${gatewayKey}`
  : `http://localhost:${PORT}${startupBasePath}`;

console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   Cybara                                                      ║
║                                                               ║
║   Dashboard:  http://localhost:${PORT}                        ║
║   API:        http://localhost:${PORT}/api                    ║
║   SSE:        http://localhost:${PORT}/api/sse/status         ║
║   WS:         ws://localhost:${PORT}/api/ws/status            ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝

  Authenticated dashboard link (works even with localhost auth required):
  ${tokenizedDashboardUrl}
`);

providerManager.seedDefaults();

// First-run nudge: if no LLM provider has credentials yet, the agent can't do
// anything useful — point the user at setup instead of leaving them guessing.
try {
  const providerStats = providerManager.getStats();
  if (providerStats.withAuth === 0) {
    console.log(`
  ⚠  No LLM provider is configured yet — Cybara can't answer prompts until you add one.
     • Guided setup:  cybara wizard
     • Or open the dashboard → Providers:  http://localhost:${PORT}
     • Or set a key, e.g.:  OPENAI_API_KEY / ANTHROPIC_API_KEY / MINIMAX_API_KEY  (see .env.example)
`);
  }
} catch {
  /* best-effort nudge */
}

setAgentHandler(async (job) => {
  const agent = agentManager.list().find((a) => a.status === "running");
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

setWakeHandler(async (text) => {
  console.log(`[Cron] Wake event received: ${text}`);
});

startScheduler();
console.log("[Cron] Scheduler initialized with agent execution support");
taskScheduler.initialize();
console.log("[Task] Scheduler initialized");

onSubagentLifecycle((event) => {
  if (event.type === "announce" && event.data?.message) {
    const sessionKey = event.data.requesterSessionKey as string;
    if (sessionKey) {
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

setChannelSubagentSpawnHandler(handleSessionsSpawn);
configureChannelChatRuntime({
  listSessions,
  sendToSession,
  memorySearch: handleMemorySearch,
  memoryContext: handleMemoryContext,
  memoryList: handleMemoryList,
  listTools: () => Object.keys(toolSchemas),
});

telegramBot.setMessageHandler(async (message, chatId, userId, channelId, fileInfo) => {
  try {
    const storedSessionId = telegramSessions.get(chatId.toString());
    const sessionId = storedSessionId || `telegram:${chatId}`;

    console.log(
      `[Telegram] Message from chatId=${chatId}, storedSessionId=${storedSessionId}, using sessionId=${sessionId}`
    );

    const fullMessage = buildMessageWithFileContext(message, fileInfo);

    const response = await handleChat({
      message: fullMessage || message,
      sessionId,
      channel: "telegram",
      userId: String(userId),
      source: "channel:telegram",
    });
    return response.message.content;
  } catch (error) {
    console.error("[Telegram] Chat handler error:", error);
    return "Sorry, I encountered an error processing your message.";
  }
});

function buildMessageWithFileContext(
  message: string,
  fileInfo?: Partial<MessageHandlerFileInfo>
): string {
  const parts: string[] = [];
  const normalizedMessage = message.trim();
  if (normalizedMessage) {
    parts.push(normalizedMessage);
  }

  if (fileInfo?.hasFile) {
    const placeholder = fileInfo.placeholder?.trim() || "";
    if (placeholder && !normalizedMessage.includes(placeholder)) {
      parts.push(placeholder);
    }

    if (fileInfo.fileType?.trim()) {
      parts.push(`[File type: ${fileInfo.fileType.trim()}]`);
    }

    if (fileInfo.filePath?.trim()) {
      parts.push(`[File attached: ${fileInfo.filePath.trim()}]`);
    }
  }

  return parts.join("\n\n");
}

const createChannelChatHandler =
  (channelName: string) =>
  async (
    message: string,
    chatId: string | number,
    sessionId: string,
    fileInfo: MessageHandlerFileInfo
  ): Promise<string> => {
    const fullMessage = buildMessageWithFileContext(message, fileInfo);
    const response = await handleChat({
      message: fullMessage || message,
      sessionId,
      channel: channelName,
      userId: String(chatId),
      source: `channel:${channelName}`,
    });
    return response.message.content;
  };

discordAdapter.setMessageHandler(createChannelChatHandler("discord"));
slackAdapter.setMessageHandler(createChannelChatHandler("slack"));
signalAdapter.setMessageHandler(createChannelChatHandler("signal"));
whatsappAdapter.setMessageHandler(createChannelChatHandler("whatsapp"));
imessageAdapter.setMessageHandler(createChannelChatHandler("imessage"));
matrixAdapter.setMessageHandler(createChannelChatHandler("matrix"));
mattermostAdapter.setMessageHandler(createChannelChatHandler("mattermost"));
ircAdapter.setMessageHandler(createChannelChatHandler("irc"));
ntfyAdapter.setMessageHandler(createChannelChatHandler("ntfy"));
twitchAdapter.setMessageHandler(createChannelChatHandler("twitch"));
lineAdapter.setMessageHandler(createChannelChatHandler("line"));
googleChatAdapter.setMessageHandler(createChannelChatHandler("googlechat"));
msTeamsAdapter.setMessageHandler(createChannelChatHandler("msteams"));
feishuAdapter.setMessageHandler(createChannelChatHandler("feishu"));
dingtalkAdapter.setMessageHandler(createChannelChatHandler("dingtalk"));
wecomAdapter.setMessageHandler(createChannelChatHandler("wecom"));
homeAssistantAdapter.setMessageHandler(createChannelChatHandler("homeassistant"));
zulipAdapter.setMessageHandler(createChannelChatHandler("zulip"));
synologyAdapter.setMessageHandler(createChannelChatHandler("synology"));
nextcloudAdapter.setMessageHandler(createChannelChatHandler("nextcloud"));
zaloAdapter.setMessageHandler(createChannelChatHandler("zalo"));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

async function initializeChannels() {
  await channelManager.initializeAll();

  if (TELEGRAM_BOT_TOKEN) {
    try {
      const existingChannels = channelManager.list();
      const hasTelegram = existingChannels.some((c) => c.type === "telegram");

      if (hasTelegram) {
        console.log(`[Telegram] Channel already initialized`);
      } else {
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

agentManager.autostartConfiguredAgents().catch((error) => {
  console.error("[Agents] Auto-start pass failed:", error);
});
