import { Client, LocalAuth, type Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { ChannelAdapter, ToolCallInfo, MessageHandler } from "../types";
import { formatToolCallsPlain } from "../formatting";
import { logChannelMessage } from "../../logging";
import { buildChannelSecurityConfig, securityManager } from "../security";
import { getDefaultWhatsAppAuthPath } from "../paths";
import { handleChannelManagementCommand } from "../commands";
import { saveInboundMediaFromBase64 } from "../media";

export const whatsappSessions = new Map<string, string>();

export function isRecoverableWhatsAppProfileProcess(
  pid: number,
  command: string,
  currentPid = process.pid,
  currentPpid = process.ppid
): boolean {
  if (!Number.isFinite(pid) || pid <= 0 || pid === currentPid || pid === currentPpid) {
    return false;
  }
  const normalized = command.toLowerCase();
  if (!normalized.trim()) return false;
  if (
    normalized.includes("cybara") ||
    normalized.includes("/bun") ||
    normalized.includes(" bun ") ||
    normalized.includes("bunx") ||
    normalized.includes("node ") ||
    normalized.includes(" sh ") ||
    normalized.includes("sh -lc") ||
    normalized.includes("pgrep") ||
    normalized.includes("lsof")
  ) {
    return false;
  }
  return (
    normalized.includes("google chrome") ||
    normalized.includes("chromium") ||
    normalized.includes("chrome helper") ||
    normalized.includes("puppeteer")
  );
}

type QRCallback = (qr: string, channelId: string) => void;
let qrCallback: QRCallback | null = null;

export function setQRCallback(callback: QRCallback): void {
  qrCallback = callback;
}

interface WhatsAppRuntimeState {
  ready: boolean;
  authenticated: boolean;
  awaitingQr: boolean;
  qr: string | null;
  qrDataUrl: string | null;
  lastEventAt: string;
  lastError: string | null;
}

interface WhatsAppAdapterConfig {
  allow_self_messages?: boolean | string | number;
  chrome_path?: string;
}

interface WhatsAppConnectionState extends WhatsAppRuntimeState {
  running: boolean;
}

function normalizeChromePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveWhatsAppChromeExecutable(
  config: Record<string, unknown> = {}
): string | undefined {
  const candidates = [
    normalizeChromePath(config.chrome_path),
    normalizeChromePath(process.env.CYBARA_WHATSAPP_CHROME_PATH),
    normalizeChromePath(process.env.PUPPETEER_EXECUTABLE_PATH),
    normalizeChromePath(process.env.CHROME_PATH),
  ];

  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  } else if (process.platform === "win32") {
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env["PROGRAMFILES(X86)"];
    const localAppData = process.env.LOCALAPPDATA;
    candidates.push(
      programFiles ? `${programFiles}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
      programFilesX86 ? `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
      localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : undefined
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    );
  }

  return candidates.find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate))
  );
}

export class WhatsAppAdapter implements ChannelAdapter {
  type = "whatsapp" as const;
  name = "WhatsApp";

  private clients = new Map<string, Client>();
  private messageHandler: MessageHandler = async () => "No handler configured";
  private readyStates = new Map<string, boolean>();
  private runtimeStates = new Map<string, WhatsAppRuntimeState>();
  private channelConfigs = new Map<string, WhatsAppAdapterConfig>();
  private accountIds = new Map<string, string>();
  private outboundMessageIds = new Map<string, Set<string>>();
  private outboundMessageSignatures = new Map<string, Map<string, number[]>>();
  private processedMessageIds = new Map<string, Set<string>>();

  private isDebugEnabled(): boolean {
    return process.env.CYBARA_WHATSAPP_DEBUG === "1";
  }

  private debugEvent(
    channelId: string,
    eventType: "message" | "message_create",
    msg: Message,
    note?: string
  ): void {
    if (!this.isDebugEnabled()) {
      return;
    }
    const messageId = msg.id?._serialized || "";
    const bodyLength = typeof msg.body === "string" ? msg.body.length : 0;
    console.log(
      `[WhatsApp][Debug] channel=${channelId} event=${eventType} fromMe=${String(msg.fromMe)} id.fromMe=${String(Boolean(msg.id?.fromMe))} from=${this.normalizeJid(msg.from)} to=${this.normalizeJid(msg.to)} bodyLength=${bodyLength}${note ? ` note=${note}` : ""} id=${messageId || "<none>"}`
    );
  }

  private getOrCreateRuntimeState(channelId: string): WhatsAppRuntimeState {
    const existing = this.runtimeStates.get(channelId);
    if (existing) {
      return existing;
    }
    const initialState: WhatsAppRuntimeState = {
      ready: false,
      authenticated: false,
      awaitingQr: false,
      qr: null,
      qrDataUrl: null,
      lastEventAt: new Date().toISOString(),
      lastError: null,
    };
    this.runtimeStates.set(channelId, initialState);
    return initialState;
  }

  private updateRuntimeState(
    channelId: string,
    updates: Partial<WhatsAppRuntimeState>
  ): WhatsAppRuntimeState {
    const nextState: WhatsAppRuntimeState = {
      ...this.getOrCreateRuntimeState(channelId),
      ...updates,
      lastEventAt: new Date().toISOString(),
    };
    this.runtimeStates.set(channelId, nextState);
    return nextState;
  }

  private normalizeSignatureText(text: string | null | undefined): string {
    if (!text) return "";
    return text
      .replace(/\s+/g, " ")
      .replace(/\u200d/g, "")
      .trim()
      .toLowerCase()
      .slice(0, 240);
  }

  private normalizeSignatureFingerprint(text: string | null | undefined): string {
    if (!text) return "";
    return this.normalizeSignatureText(text)
      .replace(/[^\p{L}\p{N}\s]+/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
  }

  private buildOutboundSignature(chatId: string | null | undefined, text: string): string {
    return `${this.normalizeJid(chatId)}:${this.normalizeSignatureText(text)}`;
  }

  private getOutboundSignatureVariants(chatId: string | null | undefined): string[] {
    const normalized = this.normalizeJid(chatId);
    if (!normalized) {
      return [];
    }

    const base = this.normalizeJidForCompare(chatId);
    const variants = new Set<string>([normalized]);
    if (base && base !== normalized) {
      variants.add(base);
      variants.add(`${base}@c.us`);
      variants.add(`${base}@s.whatsapp.net`);
      variants.add(`${base}@g.us`);
    }

    return [...variants];
  }

  private rememberOutboundMessage(
    channelId: string,
    chatId: string | null | undefined,
    text: string | null | undefined,
    message: Message | null | undefined
  ): void {
    const messageId = message?.id?._serialized;
    if (messageId) {
      let ids = this.outboundMessageIds.get(channelId);
      if (!ids) {
        ids = new Set<string>();
        this.outboundMessageIds.set(channelId, ids);
      }
      ids.add(messageId);
      if (ids.size > 200) {
        const [oldest] = ids;
        if (oldest) {
          ids.delete(oldest);
        }
      }
    }

    const normalizedText = this.normalizeSignatureText(text);
    if (!normalizedText) {
      return;
    }
    const fingerprintText = this.normalizeSignatureFingerprint(text);
    const now = Date.now();
    const variants = this.getOutboundSignatureVariants(chatId);
    const normalizedChatIds = variants.length > 0 ? variants : [this.normalizeJid(chatId)];
    for (const chatIdVariant of normalizedChatIds) {
      if (!chatIdVariant) continue;
      const signature = `${chatIdVariant}:${normalizedText}`;
      let signatures = this.outboundMessageSignatures.get(channelId);
      if (!signatures) {
        signatures = new Map<string, number[]>();
        this.outboundMessageSignatures.set(channelId, signatures);
      }
      const timestamps = signatures.get(signature) || [];
      timestamps.push(now);
      signatures.set(signature, timestamps);
      if (timestamps.length > 4) {
        timestamps.shift();
      }
      if (fingerprintText) {
        const fingerprintSignature = `${chatIdVariant}:fp:${fingerprintText}`;
        const fingerprintTimestamps = signatures.get(fingerprintSignature) || [];
        fingerprintTimestamps.push(now);
        signatures.set(fingerprintSignature, fingerprintTimestamps);
        if (fingerprintTimestamps.length > 4) {
          fingerprintTimestamps.shift();
        }
      }
      if (signatures.size > 600) {
        const oldest = signatures.keys().next().value;
        if (oldest) {
          signatures.delete(oldest);
        }
      }
    }
  }

  private consumeOutboundSignature(channelId: string, chatId: string, text: string): boolean {
    const signatures = this.outboundMessageSignatures.get(channelId);
    if (!signatures) {
      return false;
    }

    const now = Date.now();
    const validWindow = 5 * 60 * 1000;
    const normalizedText = this.normalizeSignatureText(text);
    if (!normalizedText) {
      return false;
    }
    const fingerprintText = this.normalizeSignatureFingerprint(text);

    const variants = this.getOutboundSignatureVariants(chatId);

    const consumeBySignature = (signature: string): boolean => {
      const matches = signatures.get(signature);
      if (!matches || matches.length === 0) {
        return false;
      }

      while (matches.length > 0 && now - matches[0] > validWindow) {
        matches.shift();
      }
      if (matches.length === 0) {
        signatures.delete(signature);
        return false;
      }

      matches.shift();
      if (matches.length === 0) {
        signatures.delete(signature);
      }
      if (signatures.size === 0) {
        this.outboundMessageSignatures.delete(channelId);
      }
      return true;
    };

    for (const variant of variants) {
      const signature = `${variant}:${normalizedText}`;
      if (consumeBySignature(signature)) {
        return true;
      }

      if (fingerprintText) {
        const fingerprintSignature = `${variant}:fp:${fingerprintText}`;
        if (consumeBySignature(fingerprintSignature)) {
          return true;
        }
      }
    }

    if (!fingerprintText) {
      return false;
    }

    // Fallback for event payload mismatches where exact normalized text changed.
    for (const variant of variants) {
      if (!variant) continue;
      const fingerprintPrefix = `${variant}:fp:`;
      const hasValidMatch = (signature: string, matches: number[]): boolean => {
        while (matches.length > 0 && now - matches[0] > validWindow) {
          matches.shift();
        }
        if (matches.length === 0) {
          signatures.delete(signature);
          return false;
        }

        matches.shift();
        if (matches.length === 0) {
          signatures.delete(signature);
        }
        if (signatures.size === 0) {
          this.outboundMessageSignatures.delete(channelId);
        }
        return true;
      };

      for (const [signature, matches] of signatures.entries()) {
        if (!signature.startsWith(fingerprintPrefix)) continue;

        const storedFingerprint = signature.slice(fingerprintPrefix.length);
        if (!storedFingerprint) continue;
        if (
          !storedFingerprint.includes(fingerprintText) &&
          !fingerprintText.includes(storedFingerprint)
        ) {
          continue;
        }

        if (hasValidMatch(signature, matches)) {
          return true;
        }
      }
    }

    return false;
  }

  private consumeOutboundMessage(channelId: string, messageId: string): boolean {
    const ids = this.outboundMessageIds.get(channelId);
    if (!ids?.has(messageId)) {
      return false;
    }
    ids.delete(messageId);
    return true;
  }

  private clearOutboundSignature(channelId: string, chatId: string, text: string): void {
    const signatures = this.outboundMessageSignatures.get(channelId);
    if (!signatures) return;

    const normalizedText = this.normalizeSignatureText(text);
    if (!normalizedText) return;
    const fingerprintText = this.normalizeSignatureFingerprint(text);
    const variants = this.getOutboundSignatureVariants(chatId);

    if (variants.length === 0) {
      const signature = this.buildOutboundSignature(chatId, text);
      if (signature) {
        signatures.delete(signature);
        if (fingerprintText) {
          signatures.delete(`${this.normalizeJid(chatId)}:fp:${fingerprintText}`);
        }
      }
    } else {
      for (const variant of variants) {
        signatures.delete(`${variant}:${normalizedText}`);
        if (fingerprintText) {
          signatures.delete(`${variant}:fp:${fingerprintText}`);
        }
      }
    }

    if (signatures.size === 0) {
      this.outboundMessageSignatures.delete(channelId);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private normalizeJid(value: string | undefined | null): string {
    if (!value) return "";
    return value.split(":")[0].toLowerCase();
  }

  private normalizeJidForCompare(value: string | undefined | null): string {
    if (!value) return "";
    return this.normalizeJid(value).split("@", 1)[0];
  }

  private shouldSkipMessage(channelId: string, messageId: string | undefined): boolean {
    if (!messageId) return false;

    let ids = this.processedMessageIds.get(channelId);
    if (!ids) {
      ids = new Set<string>();
      this.processedMessageIds.set(channelId, ids);
    }

    if (ids.has(messageId)) {
      return true;
    }

    ids.add(messageId);
    if (ids.size > 400) {
      const iterator = ids.values();
      const oldest = iterator.next().value;
      if (oldest) {
        ids.delete(oldest);
      }
    }
    return false;
  }

  private isSelfMessageEnabled(channelConfig: WhatsAppAdapterConfig | undefined): boolean {
    if (!channelConfig) {
      return false;
    }

    const value = channelConfig.allow_self_messages;
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      return ["true", "1", "on", "yes", "y"].includes(value.toLowerCase());
    }

    if (typeof value === "number") {
      return value === 1;
    }

    return false;
  }

  private isSelfChatMessage(channelId: string, msg: Message): boolean {
    const from = this.normalizeJidForCompare(msg.from);
    const to = this.normalizeJidForCompare(msg.to);
    if (!from) {
      return false;
    }

    if (from === to) {
      return true;
    }

    // WhatsApp may use LID (Linked Identity) format for msg.to in self-messages
    // (e.g. "222771514765317@lid" instead of "12086303682@c.us"), so from !== to
    // even though they refer to the same user. Skip the rejection when to is a LID
    // and fall through to the account ID check below.
    const toLid = msg.to && typeof msg.to === "string" && msg.to.endsWith("@lid");
    if (msg.fromMe && to && to !== from && !toLid) {
      return false;
    }

    const accountId = this.normalizeJidForCompare(this.accountIds.get(channelId));
    if (!accountId) {
      return false;
    }

    if (!to || toLid) {
      return msg.fromMe && from === accountId;
    }

    return from === accountId;
  }

  private resolveOutboundChatId(channelId: string, msg: Message): string {
    return (
      this.normalizeJid(msg.to) ||
      this.normalizeJid(msg.from) ||
      this.normalizeJid(this.accountIds.get(channelId))
    );
  }

  private isSelfEcho(
    channelId: string,
    msg: Message,
    chatId: string,
    _isMessageCreateEvent: boolean
  ): boolean {
    const messageId = msg.id?._serialized;
    if (messageId && this.consumeOutboundMessage(channelId, messageId)) {
      return true;
    }
    // Some echo payloads arrive with id.fromMe=true even though msg.fromMe=false.
    // Only suppress if they match an outbound signature; otherwise allow processing.
    if (!msg.fromMe && msg.id?.fromMe) {
      if (!msg.body) {
        return false;
      }
      return this.consumeOutboundSignature(channelId, chatId, msg.body);
    }

    // For fromMe messages (including self-chat echoes arriving via either
    // "message" or "message_create"), always check the text signature to
    // prevent infinite reply loops.
    if (!msg.body) {
      return false;
    }

    return this.consumeOutboundSignature(channelId, chatId, msg.body);
  }

  private shellQuote(input: string): string {
    return `'${input.replace(/'/g, `'\\''`)}'`;
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || "Unknown error");
  }

  private isProfileLockError(error: unknown): boolean {
    const message = this.getErrorMessage(error).toLowerCase();
    return message.includes("already running for") || message.includes("usedatadir");
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private getProcessCommand(pid: number): string {
    const output = Bun.spawnSync(["ps", "-p", String(pid), "-o", "command="], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return new TextDecoder().decode(output.stdout).trim();
  }

  private isRecoverableProfileLockProcess(pid: number): boolean {
    return isRecoverableWhatsAppProfileProcess(pid, this.getProcessCommand(pid));
  }

  private async killProcessesUsingPath(path: string): Promise<number> {
    const quotedPath = this.shellQuote(path);
    const pidQuery = `(lsof -t +D ${quotedPath} 2>/dev/null; pgrep -f ${quotedPath} 2>/dev/null) | sort -u`;
    const output = Bun.spawnSync(["sh", "-lc", pidQuery], { stdout: "pipe", stderr: "pipe" });
    const pidText = new TextDecoder().decode(output.stdout).trim();
    if (!pidText) {
      return 0;
    }

    const pids = pidText
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter(
        (pid) => Number.isFinite(pid) && pid > 0 && this.isRecoverableProfileLockProcess(pid)
      );
    if (pids.length === 0) {
      return 0;
    }

    let killed = 0;
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
        killed += 1;
      } catch {
        // Ignore; process may already be gone.
      }
    }

    await this.sleep(500);

    for (const pid of pids) {
      if (!this.isProcessAlive(pid)) continue;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Ignore; process may have exited between checks.
      }
    }

    return killed;
  }

  private async recoverProfileLock(channelId: string, authPath: string): Promise<number> {
    const sessionPath = join(authPath, `session-${channelId}`);
    let killed = await this.killProcessesUsingPath(sessionPath);
    if (killed === 0) {
      killed = await this.killProcessesUsingPath(authPath);
    }
    return killed;
  }

  setMessageHandler(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  getMessageHandler(): MessageHandler {
    return this.messageHandler;
  }

  async start(channelId: string, config: Record<string, unknown>): Promise<void> {
    if (this.clients.has(channelId)) {
      console.log(`[WhatsApp] Client already running for channel ${channelId}`);
      return;
    }

    console.log(`[WhatsApp] Starting client for channel ${channelId}...`);

    securityManager.setConfig(channelId, buildChannelSecurityConfig(config));
    this.channelConfigs.set(channelId, config as WhatsAppAdapterConfig);
    this.updateRuntimeState(channelId, {
      ready: false,
      authenticated: false,
      awaitingQr: false,
      qr: null,
      qrDataUrl: null,
      lastError: null,
    });

    const authPath = (config.auth_path as string) || getDefaultWhatsAppAuthPath(channelId);
    if (!existsSync(authPath)) {
      mkdirSync(authPath, { recursive: true });
    }

    const executablePath = resolveWhatsAppChromeExecutable(config);
    if (executablePath) {
      console.log(`[WhatsApp] Using Chrome executable: ${executablePath}`);
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: channelId,
        dataPath: authPath,
      }),
      puppeteer: {
        ...(executablePath ? { executablePath } : {}),
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
        ],
      },
    });

    client.on("qr", (qr) => {
      const existingQr = this.runtimeStates.get(channelId)?.qr;
      if (existingQr) {
        console.log(`[WhatsApp] QR code updated for channel ${channelId} (view in UI)`);
      } else {
        console.log(`[WhatsApp] Scan QR code to link device for channel ${channelId}:`);
        qrcode.generate(qr, { small: true });
      }

      this.updateRuntimeState(channelId, {
        awaitingQr: true,
        ready: false,
        authenticated: false,
        qr,
        qrDataUrl: null,
        lastError: null,
      });

      void QRCode.toDataURL(qr, { margin: 1, width: 320 })
        .then((qrDataUrl: string) => {
          this.updateRuntimeState(channelId, { qrDataUrl });
        })
        .catch((error: unknown) => {
          console.warn("[WhatsApp] Failed to generate QR image:", error);
        });

      if (qrCallback) {
        qrCallback(qr, channelId);
      }
    });

    client.on("ready", () => {
      console.log(`[WhatsApp] Client ready for channel ${channelId}`);
      this.readyStates.set(channelId, true);
      const accountId = client.info?.wid?._serialized;
      if (accountId) {
        this.accountIds.set(channelId, accountId);
      }
      this.updateRuntimeState(channelId, {
        ready: true,
        authenticated: true,
        awaitingQr: false,
        qr: null,
        qrDataUrl: null,
        lastError: null,
      });

      // Log registered event listeners so we know events are wired up
      const eventNames = (client as unknown as { _events?: Record<string, unknown> })._events;
      console.log(
        `[WhatsApp] Event listeners registered for channel ${channelId}:`,
        eventNames ? Object.keys(eventNames).join(", ") : "NONE"
      );
      console.log(
        `[WhatsApp] Account ID: ${accountId || "unknown"} | allow_self_messages: ${JSON.stringify(this.channelConfigs.get(channelId)?.allow_self_messages ?? "<not set>")}`
      );
    });

    client.on("authenticated", () => {
      const state = this.getOrCreateRuntimeState(channelId);
      if (!state.authenticated) {
        console.log(`[WhatsApp] Client authenticated for channel ${channelId}`);
      }
      const accountId = client.info?.wid?._serialized;
      if (accountId) {
        this.accountIds.set(channelId, accountId);
      }
      this.updateRuntimeState(channelId, {
        authenticated: true,
        awaitingQr: false,
        lastError: null,
      });
    });

    client.on("auth_failure", (msg) => {
      console.error(`[WhatsApp] Authentication failed for channel ${channelId}:`, msg);
      this.readyStates.set(channelId, false);
      this.updateRuntimeState(channelId, {
        ready: false,
        authenticated: false,
        awaitingQr: false,
        lastError: String(msg || "Authentication failed"),
      });
    });

    client.on("disconnected", (reason) => {
      console.log(`[WhatsApp] Client disconnected for channel ${channelId}:`, reason);
      this.readyStates.set(channelId, false);
      this.updateRuntimeState(channelId, {
        ready: false,
        awaitingQr: false,
        lastError: reason ? String(reason) : null,
      });
    });

    client.on("message", async (msg: Message) => {
      console.log(
        `[WhatsApp] >>> message event fired for channel ${channelId} | from=${msg.from} | fromMe=${msg.fromMe} | body="${(msg.body || "").slice(0, 50)}"`
      );
      this.debugEvent(channelId, "message", msg, "listener");
      await this.handleMessage(channelId, msg, "message");
    });

    client.on("message_create", async (msg: Message) => {
      console.log(
        `[WhatsApp] >>> message_create event fired for channel ${channelId} | from=${msg.from} | to=${msg.to} | fromMe=${msg.fromMe} | body="${(msg.body || "").slice(0, 50)}"`
      );
      this.debugEvent(channelId, "message_create", msg, "listener");
      // Pass all messages through to handleMessage — it already has
      // proper filtering (fromMe, allowSelfMessages, isSelfEcho, security).
      // shouldSkipMessage deduplication prevents double-processing when
      // both "message" and "message_create" fire for the same message.
      await this.handleMessage(channelId, msg, "message_create");
    });

    this.clients.set(channelId, client);
    this.readyStates.set(channelId, false);

    try {
      await client.initialize();
    } catch (error) {
      let initError: unknown = error;

      if (this.isProfileLockError(error)) {
        const killedCount = await this.recoverProfileLock(channelId, authPath);
        if (killedCount > 0) {
          console.warn(
            `[WhatsApp] Recovered profile lock for ${channelId} by terminating ${killedCount} process(es). Retrying initialization...`
          );
          try {
            await client.initialize();
            return;
          } catch (retryError) {
            initError = retryError;
          }
        }
      }

      console.error(`[WhatsApp] Failed to initialize:`, initError);
      this.updateRuntimeState(channelId, {
        ready: false,
        authenticated: false,
        awaitingQr: false,
        lastError: this.getErrorMessage(initError),
      });
      this.clients.delete(channelId);
      this.readyStates.delete(channelId);
      throw initError;
    }
  }

  private async handleMessage(
    channelId: string,
    msg: Message,
    eventType: "message" | "message_create" = "message"
  ): Promise<void> {
    const channelConfig = this.channelConfigs.get(channelId);
    const allowSelfMessages = this.isSelfMessageEnabled(channelConfig);
    const messageId = msg.id?._serialized || "";
    const from = this.normalizeJid(msg.from);
    const rawFrom = msg.from;
    const outboundChatId = this.resolveOutboundChatId(channelId, msg);

    if (messageId && this.shouldSkipMessage(channelId, messageId)) {
      this.debugEvent(channelId, eventType, msg, "skip_duplicate");
      return;
    }

    // Self-chat loops should never be reprocessed.
    const isSelfChat = this.isSelfChatMessage(channelId, msg);
    const isSelfEcho = this.isSelfEcho(
      channelId,
      msg,
      outboundChatId,
      eventType === "message_create"
    );
    if (msg.fromMe) {
      if (!allowSelfMessages || !isSelfChat) {
        if (!allowSelfMessages && isSelfChat) {
          console.log(
            `[WhatsApp] Ignoring self-chat message for channel ${channelId} — enable "Allow Self Messages" in channel config to process messages sent to your own number.`
          );
        }
        this.debugEvent(channelId, eventType, msg, "skip_outbound_not_allowed_or_not_self_chat");
        return;
      }

      if (isSelfEcho) {
        this.debugEvent(channelId, eventType, msg, "skip_self_echo");
        return;
      }
    } else if (isSelfChat && isSelfEcho) {
      this.debugEvent(channelId, eventType, msg, "skip_inbound_self_echo");
      return;
    }

    // Ignore status broadcasts
    if (rawFrom === "status@broadcast") {
      this.debugEvent(channelId, eventType, msg, "skip_status_broadcast");
      return;
    }

    const text = msg.body;
    if (!text && !msg.hasMedia) {
      this.debugEvent(channelId, eventType, msg, "skip_empty_message");
      return;
    }

    const chatId =
      from || this.normalizeJid(msg.to) || this.normalizeJid(this.accountIds.get(channelId));
    if (!chatId) {
      this.debugEvent(channelId, eventType, msg, "skip_missing_chat_id");
      return;
    }
    const userId = msg.author || msg.from; // author is set in groups
    const isGroupChat = chatId.endsWith("@g.us");

    const accessCheck =
      isSelfChat && allowSelfMessages
        ? ({ permitted: true } as const)
        : securityManager.checkAccess(channelId, userId, "whatsapp", undefined, {
            isGroup: isGroupChat,
          });

    if (!accessCheck.permitted) {
      if (accessCheck.silent) return;
      if (accessCheck.reason === "new_pairing" || accessCheck.reason === "blocked") {
        try {
          await msg.reply(accessCheck.message || `🔐 Pairing code: ${accessCheck.code}`);
        } catch (e) {
          console.error("[WhatsApp] Failed to send security message:", e);
        }
      }
      return;
    }

    this.debugEvent(channelId, eventType, msg, "processing");

    let hasFile = false;
    let filePath = "";
    let fileType = "";
    let placeholder = "";
    let content = text;

    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (media) {
          hasFile = true;
          fileType = media.mimetype;
          placeholder = `<media:${media.mimetype.split("/")[0]}>`;
          const base64Data =
            typeof (media as { data?: unknown }).data === "string"
              ? (media as { data: string }).data
              : "";
          if (base64Data) {
            const fileName =
              typeof (media as { filename?: unknown }).filename === "string"
                ? (media as { filename: string }).filename
                : `${msg.id._serialized}`;
            try {
              const saved = saveInboundMediaFromBase64({
                channel: "whatsapp",
                base64Data,
                fileName,
                contentType: media.mimetype,
              });
              filePath = saved.path;
            } catch (persistError) {
              console.warn("[WhatsApp] Failed to persist inbound media locally:", persistError);
            }
          }
          content = text || placeholder;
        }
      } catch (error) {
        console.error("[WhatsApp] Failed to download media:", error);
      }
    }

    await logChannelMessage("whatsapp", "incoming", content, {
      channelId: chatId,
      senderId: userId,
      metadata: {
        messageId: msg.id._serialized,
        isGroup: rawFrom.includes("@g.us"),
        hasMedia: msg.hasMedia,
        type: msg.type,
      },
    });

    let sessionId = whatsappSessions.get(chatId);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      whatsappSessions.set(chatId, sessionId);
    }

    let response: string;
    try {
      const commandResponse = await handleChannelManagementCommand(text || "", {
        channelId,
        chatId,
        platform: "whatsapp",
        sessionId,
        createSessionId: () => crypto.randomUUID(),
        setSessionId: (nextSessionId: string) => {
          sessionId = nextSessionId;
          whatsappSessions.set(chatId, nextSessionId);
        },
      });

      if (commandResponse !== null) {
        response = commandResponse;
      } else {
        response = await this.messageHandler(content, chatId, sessionId, {
          hasFile,
          filePath,
          fileType,
          placeholder,
        });
      }
    } catch (error) {
      console.error("[WhatsApp] Error handling message:", error);
      response = "❌ Sorry, I encountered an error processing your message. Please try again.";
    }

    await logChannelMessage("whatsapp", "outgoing", response, {
      channelId: chatId,
      metadata: { replyToId: msg.id._serialized },
    });

    let sent = false;
    this.rememberOutboundMessage(channelId, outboundChatId, response, null);

    try {
      const sentMessage = await msg.reply(response);
      this.rememberOutboundMessage(channelId, outboundChatId, response, sentMessage);
      sent = true;
    } catch (error) {
      console.error("[WhatsApp] Failed to send reply:", error);
      try {
        const chat = await msg.getChat();
        const sentMessage = await chat.sendMessage(response);
        this.rememberOutboundMessage(channelId, outboundChatId, response, sentMessage as Message);
        sent = true;
      } catch (err) {
        console.error("[WhatsApp] Failed to send message:", err);
      }
    } finally {
      if (!sent) {
        this.clearOutboundSignature(channelId, outboundChatId, response);
      }
    }
  }

  async stop(channelId: string): Promise<void> {
    const client = this.clients.get(channelId);
    if (!client) {
      console.log(`[WhatsApp] No client found for channel ${channelId}`);
      return;
    }

    console.log(`[WhatsApp] Stopping client for channel ${channelId}...`);
    try {
      await client.destroy();
    } catch (error) {
      console.error(`[WhatsApp] Error destroying client:`, error);
    }
    this.clients.delete(channelId);
    this.readyStates.delete(channelId);
    this.runtimeStates.delete(channelId);
    this.channelConfigs.delete(channelId);
    this.accountIds.delete(channelId);
    this.outboundMessageIds.delete(channelId);
    this.outboundMessageSignatures.delete(channelId);
    this.processedMessageIds.delete(channelId);
    console.log(`[WhatsApp] Stopped for channel ${channelId}`);
  }

  isRunning(channelId: string): boolean {
    return this.clients.has(channelId);
  }

  async sendMessage(
    channelId: string,
    chatId: string | number,
    text: string,
    _options?: Record<string, unknown>
  ): Promise<boolean> {
    const client = this.clients.get(channelId);
    if (!client || !this.readyStates.get(channelId)) {
      console.error("[WhatsApp] sendMessage: No ready client for channel", channelId);
      return false;
    }

    const normalizedChatId = String(chatId);
    try {
      const sentMessage = await client.sendMessage(normalizedChatId, text);
      this.rememberOutboundMessage(channelId, normalizedChatId, text, sentMessage as Message);
      return true;
    } catch (error) {
      console.error("[WhatsApp] Failed to send message:", error);
      return false;
    }
  }

  formatResponse(content: string, toolCalls?: ToolCallInfo[], thinking?: string): string {
    let text = content;

    if (toolCalls && toolCalls.length > 0) {
      text = formatToolCallsPlain(toolCalls) + "\n\n" + text;
    }

    if (thinking) {
      text += `\n\n💭 _${thinking}_`;
    }

    return text;
  }

  async getQRCode(channelId: string): Promise<string | null> {
    return this.runtimeStates.get(channelId)?.qr ?? null;
  }

  getState(channelId: string): WhatsAppConnectionState {
    const state = this.runtimeStates.get(channelId) || {
      ready: false,
      authenticated: false,
      awaitingQr: false,
      qr: null,
      qrDataUrl: null,
      lastEventAt: new Date().toISOString(),
      lastError: null,
    };
    return {
      running: this.clients.has(channelId),
      ...state,
    };
  }
}

export const whatsappAdapter = new WhatsAppAdapter();
