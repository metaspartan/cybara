import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { parseWebSocketAuthProtocol } from "../shared/websocket-auth";
import {
  handleChat,
  listPendingChatMessages,
  listSessions,
  sendToSession,
  steerPendingChatMessage,
  stopActiveChatTurn,
} from "./api/chat";
import { getClientIp } from "./api/client-ip";
import { setGatewayHostApplyHandler } from "./api/gateway-network";
import { gatewayRequestIdleTimeoutSeconds } from "./api/gateway-request-timeout";
import { createLivenessPayload, isLivenessProbe } from "./api/health-probe";
import { classifyRequestBodyReadFailure, readRequestText } from "./api/request-body";
import { handleRequest } from "./api/routes";
import {
  getGatewayAuthSettings,
  getGatewayBasePath,
  revealGatewayApiKey,
  securityCheck,
  validateMessageSize,
} from "./api/security";
import {
  createTerminalSession,
  destroyTerminalSession,
  getTerminalSession,
  listTerminalSessions,
  startOutputReader,
  writeToTerminal,
} from "./api/terminal";
import { agentManager } from "./core/agent";
import { subscribeBrowserPreviewStream } from "./core/browser/preview-stream";
import {
  BrowserPreviewInputQueue,
  executeBrowserPreviewInput,
  parseBrowserPreviewInput,
} from "./core/browser/preview-stream-input";
import {
  channelManager,
  dingtalkAdapter,
  discordAdapter,
  feishuAdapter,
  googleChatAdapter,
  homeAssistantAdapter,
  imessageAdapter,
  ircAdapter,
  lineAdapter,
  type MessageHandlerFileInfo,
  matrixAdapter,
  mattermostAdapter,
  msTeamsAdapter,
  nextcloudAdapter,
  ntfyAdapter,
  signalAdapter,
  slackAdapter,
  synologyAdapter,
  telegramBot,
  telegramSessions,
  twitchAdapter,
  webhookAdapter,
  wecomAdapter,
  whatsappAdapter,
  zaloAdapter,
  zulipAdapter,
} from "./core/channels";
import { resolveChannelAgentRouting } from "./core/channels/agent-selection";
import { configureChannelChatRuntime } from "./core/channels/chat-runtime";
import {
  handleSharedChannelManagementCommand,
  setChannelSubagentSpawnHandler,
} from "./core/channels/commands";
import {
  buildChannelImages,
  buildChannelMessageWithFileContext,
} from "./core/channels/inbound-media";
import { config } from "./core/config";
import { setAgentHandler, setWakeHandler, startScheduler } from "./core/cron";
import { startGatewayTelemetryMaintenance } from "./core/metrics";
import { startNativeParentWatch } from "./core/native-parent-watch";
import { nearbyService } from "./core/nearby";
import { listInstalledPlugins } from "./core/plugins";
import { activateInstalledPluginRuntimes } from "./core/plugins/runtime";
import { providerManager } from "./core/providers";
import { getEmbeddedUiBundle, readEmbeddedUiIndex } from "./core/runtime/embedded-ui";
import { installGatewayLogCapture } from "./core/runtime/gateway-log-file";
import {
  gatewayPortCandidates,
  gatewayPortFallbackCount,
  gatewayPortSignal,
} from "./core/runtime/gateway-port";
import { resolveMediaFile } from "./core/runtime/media-files";
import { isCompiledRuntime } from "./core/runtime/runtime-mode";
import { readUiIndexContent } from "./core/runtime/ui-index";
import { resolveUiPath } from "./core/runtime/ui-path";
import { logSandboxRuntimeStatus } from "./core/sandbox";
import { taskScheduler } from "./core/scheduler";
import {
  addSSEClient,
  createStatusSnapshotEvent,
  onStatus,
  onStatusStream,
  removeSSEClient,
} from "./core/status";
import { StatusStreamSender } from "./core/status-stream-sender";
import { handleSessionsSpawn } from "./core/tools/handlers/channel";
import {
  handleMemoryContext,
  handleMemoryList,
  handleMemorySearch,
} from "./core/tools/handlers/memory";
import { toolSchemas } from "./core/tools/index";

const __dirname = dirname(fileURLToPath(import.meta.url));

installGatewayLogCapture({ environment: process.env });
startNativeParentWatch();

const isCompiledBinary = isCompiledRuntime();

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
const embeddedUi = getEmbeddedUiBundle();
let uiContent: string;
let uiExists = false;
let externalUiExists = false;

try {
  uiContent = readFileSync(join(uiPath, "index.html"), "utf-8");
  uiExists = true;
  externalUiExists = true;
  console.log(`[UI] Serving UI from: ${uiPath}`);
} catch {
  const embeddedIndex = embeddedUi ? readEmbeddedUiIndex(embeddedUi) : undefined;
  if (embeddedIndex) {
    uiContent = embeddedIndex;
    uiExists = true;
    console.log("[UI] Serving embedded UI");
  } else {
    console.error(
      `[UI] Failed to load UI index at ${join(uiPath, "index.html")} (execPath=${process.execPath}, cwd=${process.cwd()})`
    );
    uiContent = `<!DOCTYPE html><html><head><title>Cybara</title></head><body style="font-family: system-ui; background: #0a0a0f; color: #f0f0f5; padding: 40px;"><h1>Cybara</h1><p>UI not built. Run <code>cd ui && bun run build</code> to build the React app.</p></body></html>`;
  }
}

function readUiIndex(): string {
  const raw = readUiIndexContent({
    uiPath,
    uiExists: externalUiExists,
    fallbackContent: uiContent,
  });
  const basePath = getGatewayBasePath();
  if (!basePath) return raw;
  return raw
    .replaceAll('src="/', `src="${basePath}/`)
    .replaceAll('href="/', `href="${basePath}/`)
    .replace("<head>", `<head><meta name="cybara-base-path" content="${basePath}">`);
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

function parsePortFlag(argv: string[]): number | undefined {
  let raw: string | undefined;
  const index = argv.findIndex((arg) => arg === "--port" || arg === "-p");
  if (index >= 0 && argv[index + 1]) {
    raw = argv[index + 1];
  } else {
    const inline = argv.find((arg) => arg.startsWith("--port="));
    if (inline) raw = inline.slice("--port=".length);
  }
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : undefined;
}

let PORT = parsePortFlag(process.argv) || Number(process.env.PORT) || platformConfig.port || 4269;
process.env.CYBARA_RUNTIME_PORT = String(PORT);

function htmlHeaders(): Record<string, string> {
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
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "Content-Security-Policy": contentSecurityPolicy,
    ...commonSecurityHeaders,
  };
}

function isFileLikePath(pathname: string): boolean {
  return /\.[^/]+$/.test(pathname);
}

const isExposeFlagSet = process.argv.includes("--expose");
function isAllInterfaceHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

const configuredHost =
  typeof platformConfig.host === "string" && platformConfig.host.trim()
    ? platformConfig.host.trim()
    : "127.0.0.1";
const HOST =
  process.env.CYBARA_HOST || (isExposeFlagSet ? "0.0.0.0" : configuredHost) || "127.0.0.1";
let runtimeHost = HOST;
process.env.CYBARA_RUNTIME_HOST = runtimeHost;
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
      sender?: StatusStreamSender;
    }
  | {
      kind: "browser";
      pageId: string;
      quality: number;
      maxWidth: number;
      maxHeight: number;
      everyNthFrame: number;
      unsubscribe?: () => Promise<void>;
      closed?: boolean;
      inputQueue?: BrowserPreviewInputQueue;
    };

function browserStreamPageId(pathname: string): string | null {
  const match = /^\/api\/browser\/tabs\/([^/]+)\/stream$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    const pageId = decodeURIComponent(match[1]).trim();
    return pageId && pageId.length <= 256 ? pageId : null;
  } catch {
    return null;
  }
}

function boundedStreamParameter(
  url: URL,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(url.searchParams.get(name));
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, Math.round(parsed)))
    : fallback;
}

function withOptionalQueryToken(headers: Record<string, string>, url: URL): Record<string, string> {
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

function resolveStreamAuth(
  headers: Record<string, string>,
  url: URL
): { headers: Record<string, string>; protocol?: string } {
  const parsed = parseWebSocketAuthProtocol(
    headers["sec-websocket-protocol"] || headers["Sec-WebSocket-Protocol"]
  );
  let resolved = headers;
  if (parsed?.token && !resolved.authorization && !resolved.Authorization) {
    resolved = { ...resolved, authorization: `Bearer ${parsed.token}` };
  }
  if (
    parsed?.password &&
    !resolved["x-cybara-gateway-password"] &&
    !resolved["X-Cybara-Gateway-Password"]
  ) {
    resolved = { ...resolved, "x-cybara-gateway-password": parsed.password };
  }
  return {
    headers: withOptionalQueryToken(resolved, url),
    protocol: parsed?.protocol,
  };
}

function createGatewayServer(
  hostname: string,
  port: number = PORT
): ReturnType<typeof Bun.serve<WsData>> {
  process.env.CYBARA_RUNTIME_HOST = hostname;
  return Bun.serve<WsData>({
    port,
    hostname,
    idleTimeout: 255,
    fetch: async (req, server) => {
      const url = new URL(req.url);
      let pathname = url.pathname;

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

      if (isLivenessProbe(req.method, pathname)) {
        return new Response(JSON.stringify(createLivenessPayload()), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...commonSecurityHeaders,
          },
        });
      }

      const requestIdleTimeout = gatewayRequestIdleTimeoutSeconds(req.method, pathname);
      if (requestIdleTimeout !== null) {
        server.timeout(req, requestIdleTimeout);
      }

      const requestHeaders = Object.fromEntries(req.headers.entries());
      const directIp = server.requestIP?.(req)?.address;
      const clientIp = getClientIp(requestHeaders, directIp);

      if (pathname.startsWith("/api/terminal")) {
        const terminalAuth = resolveStreamAuth(requestHeaders, url);
        const security = securityCheck(req.method, pathname, terminalAuth.headers, clientIp);
        if (!security.passed) {
          return new Response(JSON.stringify({ error: security.error }), {
            status: security.statusCode || 403,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...commonSecurityHeaders,
              ...security.headers,
            },
          });
        }

        if (!isTerminalEnabled()) {
          return new Response(
            JSON.stringify({
              error: "Terminal disabled. Start with --enable-terminal",
            }),
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
          const success = server.upgrade(req, {
            data: { kind: "terminal", sessionId },
            headers: terminalAuth.protocol
              ? { "Sec-WebSocket-Protocol": terminalAuth.protocol }
              : undefined,
          });
          if (success) return undefined;
          return new Response("WebSocket upgrade failed", {
            status: 400,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              ...commonSecurityHeaders,
            },
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

      const browserStreamId = browserStreamPageId(pathname);
      if (browserStreamId) {
        const streamAuth = resolveStreamAuth(requestHeaders, url);
        const security = securityCheck(req.method, pathname, streamAuth.headers, clientIp);
        if (!security.passed) {
          return new Response(JSON.stringify({ error: security.error }), {
            status: security.statusCode || 403,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...commonSecurityHeaders,
              ...security.headers,
            },
          });
        }
        const success = server.upgrade(req, {
          data: {
            kind: "browser",
            pageId: browserStreamId,
            quality: boundedStreamParameter(url, "quality", 58, 40, 85),
            maxWidth: boundedStreamParameter(url, "maxWidth", 1280, 320, 2560),
            maxHeight: boundedStreamParameter(url, "maxHeight", 900, 320, 1600),
            everyNthFrame: boundedStreamParameter(url, "everyNthFrame", 1, 1, 4),
          },
          headers: streamAuth.protocol
            ? { "Sec-WebSocket-Protocol": streamAuth.protocol }
            : undefined,
        });
        if (success) return undefined;
        return new Response("WebSocket upgrade failed", {
          status: 400,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...commonSecurityHeaders,
          },
        });
      }

      if (pathname === "/api/ws/status") {
        const statusAuth = resolveStreamAuth(requestHeaders, url);
        const security = securityCheck(req.method, pathname, statusAuth.headers, clientIp);
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

        const success = server.upgrade(req, {
          data: { kind: "status" },
          headers: statusAuth.protocol
            ? { "Sec-WebSocket-Protocol": statusAuth.protocol }
            : undefined,
        });
        if (success) return undefined;
        return new Response("WebSocket upgrade failed", {
          status: 400,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...commonSecurityHeaders,
          },
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

      if (pathname === "/api/media") {
        const mediaHeaders = withOptionalQueryToken(requestHeaders, url);
        const security = securityCheck(req.method, pathname, mediaHeaders, clientIp);
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
        const result = resolveMediaFile(url.searchParams.get("path") || "");
        if (result.status !== 200 || !result.bytes || !result.contentType) {
          return new Response(JSON.stringify({ error: result.error || "error" }), {
            status: result.status,
            headers: {
              "Content-Type": "application/json",
              ...commonSecurityHeaders,
              ...security.headers,
            },
          });
        }
        return new Response(result.bytes, {
          headers: {
            "Content-Type": result.contentType,
            "Cache-Control": "private, max-age=3600",
            ...commonSecurityHeaders,
            ...security.headers,
          },
        });
      }

      if (pathname.startsWith("/api/")) {
        const preflightSecurity =
          req.method === "OPTIONS"
            ? undefined
            : securityCheck(req.method, pathname, requestHeaders, clientIp);
        if (preflightSecurity && !preflightSecurity.passed) {
          const response = await handleRequest({
            method: req.method,
            url: basePath ? `${url.origin}${pathname}${url.search}` : req.url,
            headers: requestHeaders,
            ip: clientIp,
            security: preflightSecurity,
          });
          return new Response(JSON.stringify(response.body), {
            status: response.status,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...commonSecurityHeaders,
              ...response.headers,
            },
          });
        }
        let body: unknown;
        let rawBody: string | undefined;
        let malformedBody = false;
        if (req.method !== "GET" && req.method !== "HEAD") {
          const needsRaw = pathname.endsWith("/webhook") || pathname.includes("/webhooks/");
          let text = "";
          try {
            const maxBodyBytes = pathname.startsWith("/api/plugins/")
              ? 48 * 1024 * 1024
              : 64 * 1024 * 1024;
            text = await readRequestText(req, maxBodyBytes);
          } catch (error) {
            const failure = classifyRequestBodyReadFailure(error);
            return new Response(
              JSON.stringify({
                error: failure.message,
                code: failure.code,
                path: pathname,
              }),
              {
                status: failure.status,
                headers: {
                  "Content-Type": "application/json",
                  ...commonSecurityHeaders,
                },
              }
            );
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
            JSON.stringify({
              error: "Invalid JSON body",
              code: "VALIDATION_ERROR",
              path: pathname,
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                ...commonSecurityHeaders,
              },
            }
          );
        }
        const response = await handleRequest({
          method: req.method,
          url: basePath ? `${url.origin}${pathname}${url.search}` : req.url,
          headers: requestHeaders,
          body,
          rawBody,
          ip: clientIp,
          security: preflightSecurity,
        });
        return new Response(
          response.raw ? String(response.body ?? "") : JSON.stringify(response.body),
          {
            status: response.status,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
              ...commonSecurityHeaders,
              ...response.headers,
            },
          }
        );
      }

      const fileLikePath = isFileLikePath(pathname);

      if (!uiExists) {
        if (pathname === "/" || pathname === "/index.html" || !fileLikePath) {
          return new Response(readUiIndex(), { headers: htmlHeaders() });
        }
        return new Response("Static asset not found", {
          status: 404,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...commonSecurityHeaders,
          },
        });
      }

      if (pathname === "/" || pathname === "/index.html" || !fileLikePath) {
        return new Response(readUiIndex(), { headers: htmlHeaders() });
      }

      if (!externalUiExists) {
        const embeddedAssetPath = embeddedUi?.assets[pathname];
        if (!embeddedAssetPath) {
          return new Response("Static asset not found", {
            status: 404,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              ...commonSecurityHeaders,
            },
          });
        }
        const ext = pathname.substring(pathname.lastIndexOf("."));
        const contentType = mimeTypes[ext] || "application/octet-stream";
        try {
          return new Response(readFileSync(embeddedAssetPath), {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": cacheControlForStaticAsset(ext),
              ...commonSecurityHeaders,
            },
          });
        } catch {
          return new Response("File error", {
            status: 500,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              ...commonSecurityHeaders,
            },
          });
        }
      }

      const uiRoot = resolve(uiPath);
      const filePath = resolve(uiRoot, pathname.replace(/^\/+/, ""));
      const withinUiRoot = filePath === uiRoot || filePath.startsWith(uiRoot + sep);

      if (withinUiRoot && existsSync(filePath) && !filePath.includes(".git")) {
        if (statSync(filePath).isDirectory()) {
          return new Response("Directory listing not allowed", {
            status: 403,
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              ...commonSecurityHeaders,
            },
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
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              ...commonSecurityHeaders,
            },
          });
        }
      }

      if (fileLikePath) {
        return new Response("Static asset not found", {
          status: 404,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...commonSecurityHeaders,
          },
        });
      }

      return new Response(uiContent, { headers: htmlHeaders() });
    },
    websocket: {
      open(ws) {
        const data = ws.data as WsData;
        if (data.kind === "status") {
          try {
            const sender = new StatusStreamSender({
              send: (message) => {
                ws.send(message);
              },
              close: (code, reason) => ws.close(code, reason),
              getBufferedAmount: () => ws.getBufferedAmount(),
            });
            data.sender = sender;
            sender.send(createStatusSnapshotEvent());
            const unsubscribe = onStatusStream((event) => {
              try {
                sender.send(event);
              } catch {}
            });
            data.unsubscribe = unsubscribe;
          } catch (error) {
            console.debug("[Status WS] Failed to initialize websocket:", error);
            try {
              ws.close();
            } catch {}
          }
          return;
        }

        if (data.kind === "browser") {
          data.inputQueue = new BrowserPreviewInputQueue(
            async (input) => await executeBrowserPreviewInput(data.pageId, input),
            (error) => {
              if (data.closed) return;
              try {
                ws.send(
                  JSON.stringify({
                    type: "input_error",
                    error: error instanceof Error ? error.message : "Browser input failed",
                  })
                );
              } catch {
                return;
              }
            }
          );
          void subscribeBrowserPreviewStream(
            data.pageId,
            {
              quality: data.quality,
              maxWidth: data.maxWidth,
              maxHeight: data.maxHeight,
              everyNthFrame: data.everyNthFrame,
            },
            (frame) => {
              if (data.closed || ws.getBufferedAmount() > 1_048_576) return;
              try {
                ws.send(frame);
              } catch {
                return;
              }
            }
          ).then(
            async (unsubscribe) => {
              if (data.closed) {
                await unsubscribe();
                return;
              }
              data.unsubscribe = unsubscribe;
            },
            (error: unknown) => {
              try {
                ws.send(
                  JSON.stringify({
                    type: "error",
                    error: error instanceof Error ? error.message : "Browser stream failed",
                  })
                );
                ws.close(1011, "Browser stream failed");
              } catch {
                return;
              }
            }
          );
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
            } catch {}
          }
          return;
        }

        if (data.kind === "browser") {
          const text = typeof message === "string" ? message : Buffer.from(message).toString();
          if (text === "ping") {
            try {
              ws.send("pong");
            } catch {
              return;
            }
            return;
          }
          if (Buffer.byteLength(text) > 2_048) return;
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            return;
          }
          const input = parseBrowserPreviewInput(parsed);
          if (!input) return;
          data.inputQueue?.enqueue(input);
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
          data.sender?.dispose();
          data.unsubscribe?.();
          return;
        }
        if (data.kind === "browser") {
          data.closed = true;
          data.inputQueue?.dispose();
          void data.unsubscribe?.();
          return;
        }
        destroyTerminalSession(data.sessionId);
      },
    },
  });
}

function createInitialGatewayServer(hostname: string): ReturnType<typeof Bun.serve<WsData>> {
  const candidates = gatewayPortCandidates(
    PORT,
    gatewayPortFallbackCount(process.env.CYBARA_PORT_FALLBACK_COUNT)
  );
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      const server = createGatewayServer(hostname, candidate);
      PORT = server.port ?? candidate;
      process.env.CYBARA_RUNTIME_PORT = String(PORT);
      return server;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No gateway port is available");
}

let gatewayServer = createInitialGatewayServer(runtimeHost);
if (process.env.CYBARA_GATEWAY_PORT_SIGNAL === "stdout") {
  console.log(gatewayPortSignal(PORT));
}
startGatewayTelemetryMaintenance();

nearbyService.initialize().catch((error) => {
  console.error(
    `[Nearby] Failed to initialize: ${error instanceof Error ? error.message : String(error)}`
  );
});

setGatewayHostApplyHandler((nextHost) => {
  const requestedHost = nextHost.trim();
  if (!requestedHost || requestedHost === runtimeHost) return;
  setTimeout(() => {
    const previousHost = runtimeHost;
    try {
      gatewayServer.stop(true);
      gatewayServer = createGatewayServer(requestedHost);
      runtimeHost = requestedHost;
      console.warn(`[Gateway] Rebound listener from ${previousHost} to ${runtimeHost}:${PORT}`);
      printStartupSecurityWarnings();
    } catch (error) {
      console.error(
        `[Gateway] Failed to bind ${requestedHost}:${PORT}: ${
          error instanceof Error ? error.message : error
        }`
      );
      try {
        gatewayServer = createGatewayServer(previousHost);
        runtimeHost = previousHost;
      } catch (rollbackError) {
        console.error(
          `[Gateway] Failed to restore ${previousHost}:${PORT}: ${
            rollbackError instanceof Error ? rollbackError.message : rollbackError
          }`
        );
      }
    } finally {
      process.env.CYBARA_RUNTIME_HOST = runtimeHost;
    }
  }, 250);
});

revealGatewayApiKey();
const startupBasePath = getGatewayBasePath();
const dashboardUrl = `http://localhost:${PORT}${startupBasePath}`;

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

  Dashboard:
  ${dashboardUrl}
`);

function printStartupSecurityWarnings(): void {
  const warnings: string[] = [];
  const auth = getGatewayAuthSettings();
  if (auth.localhostBypassActive) {
    warnings.push(
      "Localhost browser auth bypass is active for development. Set CYBARA_REQUIRE_AUTH=1 or enable localhost auth in Settings for stricter local access."
    );
  }
  if (isAllInterfaceHost(runtimeHost)) {
    warnings.push(
      "Gateway is listening on all interfaces. Keep bearer tokens private and use only on trusted networks."
    );
  } else if (!isLoopbackHost(runtimeHost)) {
    warnings.push(
      `Gateway is listening on ${runtimeHost}. Devices on that network can reach it if they have a valid token.`
    );
  }
  if (isTerminalEnabled()) {
    warnings.push(
      "Web terminal is enabled. It remains auth- and scope-gated, but grants shell access."
    );
  }
  if (warnings.length > 0) {
    console.warn(
      `\nSecurity warnings:\n${warnings.map((warning) => `  - ${warning}`).join("\n")}\n`
    );
  }
}

printStartupSecurityWarnings();

providerManager.seedDefaults();
try {
  activateInstalledPluginRuntimes(listInstalledPlugins());
} catch (error) {
  console.error("[Plugins] Runtime activation failed:", error);
}

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
} catch {}

setAgentHandler(async (job) => {
  const agent = job.agentId
    ? agentManager.get(job.agentId)
    : agentManager.list().find((a) => a.status === "running");
  if (!agent) {
    return {
      success: false,
      error: job.agentId
        ? `Cron job agent ${job.agentId} no longer exists`
        : "No running agent available",
    };
  }

  try {
    const message = job.payload.kind === "agentTurn" ? job.payload.message : String(job.payload);
    const result = await agentManager.message(agent.id, message, {
      workspaceDir: job.workspaceDir,
    });
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

setChannelSubagentSpawnHandler(handleSessionsSpawn);
configureChannelChatRuntime({
  listSessions,
  sendToSession,
  memorySearch: handleMemorySearch,
  memoryContext: handleMemoryContext,
  memoryList: handleMemoryList,
  listTools: () => Object.keys(toolSchemas),
  listPending: listPendingChatMessages,
  queue: async (sessionId, message) => {
    const response = await handleChat({
      message,
      sessionId,
      queueMode: "queue",
      source: "channel",
    });
    return {
      queued: response.queued === true,
      pendingMessages: response.pendingMessages || [],
    };
  },
  steer: async (sessionId, pendingMessageId) => {
    const response = await steerPendingChatMessage(sessionId, pendingMessageId);
    return {
      success: response.success,
      ...(response.success ? {} : { error: response.error }),
      pendingMessages: response.pendingMessages,
    };
  },
  stop: stopActiveChatTurn,
});

telegramBot.setMessageHandler(async (message, chatId, userId, channelId, fileInfo) => {
  try {
    const storedSessionId = telegramSessions.get(chatId.toString());
    const sessionId = storedSessionId || `telegram:${chatId}`;

    console.log(
      `[Telegram] Message from chatId=${chatId}, storedSessionId=${storedSessionId}, using sessionId=${sessionId}`
    );

    const fullMessage = buildChannelMessageWithFileContext(message, fileInfo);
    const validation = validateMessageSize(fullMessage || message);
    if (!validation.valid) return validation.error || "Message is too large";
    const images = buildChannelImages(fileInfo);
    const routing = resolveChannelAgentRouting(channelId, agentManager.list());

    const response = await handleChat({
      message: fullMessage || message,
      agentId: routing.agentId,
      useModelRouter: routing.useModelRouter,
      sessionId,
      channel: "telegram",
      userId: String(userId),
      source: "channel:telegram",
      ...(images.length ? { images } : {}),
    });
    return response.message.content;
  } catch (error) {
    console.error("[Telegram] Chat handler error:", error);
    return "Sorry, I encountered an error processing your message.";
  }
});

const createChannelChatHandler =
  (channelName: string) =>
  async (
    message: string,
    chatId: string | number,
    sessionId: string,
    fileInfo: MessageHandlerFileInfo
  ): Promise<string> => {
    const commandResponse = await handleSharedChannelManagementCommand(message, {
      channelId: fileInfo.channelId,
      chatId,
      platform: channelName,
      sessionId,
    });
    if (commandResponse !== null) return commandResponse;
    const fullMessage = buildChannelMessageWithFileContext(message, fileInfo);
    const validation = validateMessageSize(fullMessage || message);
    if (!validation.valid) return validation.error || "Message is too large";
    const images = buildChannelImages(fileInfo);
    const routing = resolveChannelAgentRouting(fileInfo.channelId, agentManager.list());
    const response = await handleChat({
      message: fullMessage || message,
      agentId: routing.agentId,
      useModelRouter: routing.useModelRouter,
      sessionId,
      channel: channelName,
      userId: String(chatId),
      source: `channel:${channelName}`,
      ...(images.length ? { images } : {}),
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
webhookAdapter.setMessageHandler(createChannelChatHandler("webhook"));
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
