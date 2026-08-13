import type {
  MobileStatusStreamEvent,
  MobileStatusStreamHandlers,
  MobileStatusStreamOptions,
} from "./api-types";

type MobileWebSocketConstructor = NonNullable<MobileStatusStreamOptions["WebSocketImpl"]>;
type MobileWebSocket = InstanceType<MobileWebSocketConstructor>;
type MobileStatusEventNormalizer = (value: unknown) => MobileStatusStreamEvent | null;

interface BufferedMobileStatusEvent {
  event: MobileStatusStreamEvent;
  capturedAt: number;
  dedupeKey: string | null;
}

function replayableEvent(event: MobileStatusStreamEvent): boolean {
  return (
    (event.type === "status" || event.type === "assistant_token") &&
    typeof event.sessionId === "string" &&
    Boolean(event.sessionId.trim())
  );
}

function replayDedupeKey(event: MobileStatusStreamEvent): string | null {
  if (event.type !== "status" && event.type !== "assistant_token") return null;
  const sequence = typeof event.sequence === "number" && event.sequence > 0 ? event.sequence : 0;
  if (!sequence) return null;
  return `${event.sessionId || ""}\u0000${event.runId || ""}\u0000${sequence}`;
}

export class MobileStatusReplayBuffer {
  private readonly entries: BufferedMobileStatusEvent[] = [];
  private readonly dedupeKeys = new Set<string>();

  constructor(
    private readonly maxEvents = 1000,
    private readonly staleMs = 15 * 60 * 1000
  ) {}

  record(event: MobileStatusStreamEvent, capturedAt = Date.now()): void {
    this.prune(capturedAt);
    if (!replayableEvent(event)) return;
    const dedupeKey = replayDedupeKey(event);
    if (dedupeKey && this.dedupeKeys.has(dedupeKey)) return;
    this.entries.push({ event, capturedAt, dedupeKey });
    if (dedupeKey) this.dedupeKeys.add(dedupeKey);
    while (this.entries.length > this.maxEvents) this.removeFirst();
  }

  consume(now = Date.now(), sessionId?: string): MobileStatusStreamEvent[] {
    this.prune(now);
    const matched: BufferedMobileStatusEvent[] = [];
    const retained: BufferedMobileStatusEvent[] = [];
    for (const entry of this.entries) {
      if (!sessionId || ("sessionId" in entry.event && entry.event.sessionId === sessionId)) {
        matched.push(entry);
      } else retained.push(entry);
    }
    const events = matched.map(({ event }) => ({ ...event }));
    this.entries.splice(0, this.entries.length, ...retained);
    this.dedupeKeys.clear();
    for (const entry of retained) {
      if (entry.dedupeKey) this.dedupeKeys.add(entry.dedupeKey);
    }
    return events;
  }

  get size(): number {
    return this.entries.length;
  }

  private prune(now: number): void {
    while (this.entries[0] && now - this.entries[0].capturedAt > this.staleMs) {
      this.removeFirst();
    }
  }

  private removeFirst(): void {
    const removed = this.entries.shift();
    if (removed?.dedupeKey) this.dedupeKeys.delete(removed.dedupeKey);
  }
}

export class MobileStatusStreamClient {
  private readonly subscribers = new Set<MobileStatusStreamHandlers>();
  private readonly replayBuffer = new MobileStatusReplayBuffer();
  private socket: MobileWebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private lastMessageAt = 0;
  private socketGeneration = 0;
  private connected = false;
  private options: Required<
    Pick<
      MobileStatusStreamOptions,
      "reconnectDelayMs" | "maxReconnectDelayMs" | "closeGraceMs" | "heartbeatMs" | "staleMs"
    >
  > = {
    reconnectDelayMs: 350,
    maxReconnectDelayMs: 2000,
    closeGraceMs: 30_000,
    heartbeatMs: 15_000,
    staleMs: 45_000,
  };
  private WebSocketImpl: MobileWebSocketConstructor | null = null;

  constructor(
    private readonly getUrl: () => string,
    private readonly normalizeEvent: MobileStatusEventNormalizer
  ) {}

  subscribe(
    handlers: MobileStatusStreamHandlers,
    options: MobileStatusStreamOptions = {}
  ): () => void {
    this.configure(options);
    this.clearCloseTimer();
    this.subscribers.add(handlers);
    if (options.replayBufferedEvents) {
      for (const event of this.replayBuffer.consume(Date.now(), options.replaySessionId)) {
        handlers.onEvent(event);
      }
    }
    if (this.connected) handlers.onOpen?.();
    this.ensureConnected();
    return () => {
      this.subscribers.delete(handlers);
      if (this.subscribers.size === 0) this.scheduleClose();
    };
  }

  reset(): void {
    this.socketGeneration += 1;
    this.connected = false;
    this.clearReconnectTimer();
    this.clearCloseTimer();
    this.clearHeartbeat();
    this.closeSocket();
    this.reconnectAttempts = 0;
    if (this.subscribers.size > 0) this.ensureConnected();
  }

  private configure(options: MobileStatusStreamOptions): void {
    this.options = {
      reconnectDelayMs: Math.max(50, options.reconnectDelayMs ?? this.options.reconnectDelayMs),
      maxReconnectDelayMs: Math.max(
        50,
        options.maxReconnectDelayMs ?? this.options.maxReconnectDelayMs
      ),
      closeGraceMs: Math.max(0, options.closeGraceMs ?? this.options.closeGraceMs),
      heartbeatMs: Math.max(0, options.heartbeatMs ?? this.options.heartbeatMs),
      staleMs: Math.max(0, options.staleMs ?? this.options.staleMs),
    };
    this.WebSocketImpl =
      options.WebSocketImpl ??
      this.WebSocketImpl ??
      (globalThis as { WebSocket?: MobileWebSocketConstructor }).WebSocket ??
      null;
  }

  private ensureConnected(): void {
    if (this.socket || this.reconnectTimer || this.subscribers.size === 0) return;
    if (!this.WebSocketImpl) {
      this.notifyError();
      return;
    }
    const generation = ++this.socketGeneration;
    let socket: MobileWebSocket;
    try {
      socket = new this.WebSocketImpl(this.getUrl());
      this.socket = socket;
    } catch {
      this.notifyError();
      this.scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      if (generation !== this.socketGeneration) return;
      this.connected = true;
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      this.startHeartbeat(generation);
      for (const subscriber of this.subscribers) subscriber.onOpen?.();
    };
    socket.onmessage = (message) => {
      if (generation !== this.socketGeneration) return;
      this.lastMessageAt = Date.now();
      if (String(message.data) === "pong") return;
      try {
        const event = this.normalizeEvent(JSON.parse(String(message.data)));
        if (!event) return;
        if (this.subscribers.size === 0) this.replayBuffer.record(event);
        for (const subscriber of this.subscribers) subscriber.onEvent(event);
      } catch {}
    };
    socket.onclose = () => {
      if (generation !== this.socketGeneration) return;
      this.connected = false;
      this.clearHeartbeat();
      this.socket = null;
      for (const subscriber of this.subscribers) subscriber.onClose?.();
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      if (generation !== this.socketGeneration) return;
      this.notifyError();
      try {
        socket.close();
      } catch {
        this.socket = null;
        this.scheduleReconnect();
      }
    };
  }

  private startHeartbeat(generation: number): void {
    this.clearHeartbeat();
    if (this.options.heartbeatMs === 0) return;
    this.heartbeatTimer = setInterval(() => {
      if (generation !== this.socketGeneration || !this.socket) return;
      if (this.options.staleMs > 0 && Date.now() - this.lastMessageAt > this.options.staleMs) {
        this.socket.close();
        return;
      }
      try {
        this.socket.send?.("ping");
      } catch {
        this.socket.close();
      }
    }, this.options.heartbeatMs);
  }

  private scheduleReconnect(): void {
    if (this.subscribers.size === 0 || this.reconnectTimer) return;
    const delay = Math.min(
      this.options.maxReconnectDelayMs,
      this.options.reconnectDelayMs * 2 ** this.reconnectAttempts
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private scheduleClose(): void {
    this.clearCloseTimer();
    if (this.options.closeGraceMs === 0) {
      this.reset();
      return;
    }
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      if (this.subscribers.size > 0) return;
      this.reset();
    }, this.options.closeGraceMs);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      socket.close();
    } catch {}
  }

  private notifyError(): void {
    for (const subscriber of this.subscribers) subscriber.onError?.();
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearCloseTimer(): void {
    if (!this.closeTimer) return;
    clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  private clearHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
