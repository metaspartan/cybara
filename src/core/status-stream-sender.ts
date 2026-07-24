import type { StatusStreamEvent, TokenStreamEventPayload } from "./status";

export interface StatusStreamSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  getBufferedAmount(): number;
}

interface PendingTokenEvent extends TokenStreamEventPayload {
  delta: string;
}

export const STATUS_STREAM_TOKEN_FLUSH_MS = 16;
export const STATUS_STREAM_MAX_BUFFERED_BYTES = 1_048_576;

export class StatusStreamSender {
  private readonly pendingTokens = new Map<string, PendingTokenEvent>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly socket: StatusStreamSocket,
    private readonly tokenFlushMs = STATUS_STREAM_TOKEN_FLUSH_MS,
    private readonly maxBufferedBytes = STATUS_STREAM_MAX_BUFFERED_BYTES
  ) {}

  send(event: StatusStreamEvent): void {
    if (this.disposed) return;
    if (event.type !== "assistant_token") {
      this.flush();
      this.transmit(event);
      return;
    }
    const key = `${event.sessionId}\u0000${event.runId ?? ""}\u0000${event.agentId ?? ""}`;
    const pending = this.pendingTokens.get(key);
    if (pending) {
      pending.delta += event.delta;
      pending.timestamp = event.timestamp;
      pending.sequence = event.sequence;
    } else {
      this.pendingTokens.set(key, { ...event });
    }
    this.scheduleFlush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pendingTokens.clear();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.disposed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.tokenFlushMs);
  }

  private flush(): void {
    if (this.pendingTokens.size === 0 || this.disposed) return;
    const events = [...this.pendingTokens.values()];
    this.pendingTokens.clear();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const event of events) this.transmit(event);
  }

  private transmit(event: StatusStreamEvent): void {
    if (this.disposed) return;
    if (this.socket.getBufferedAmount() > this.maxBufferedBytes) {
      this.socket.close(1013, "Status stream client fell behind");
      this.dispose();
      return;
    }
    this.socket.send(JSON.stringify(event));
  }
}
