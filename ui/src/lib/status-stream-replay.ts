import type {
  StatusStreamEvent,
  StatusStreamStatusEvent,
  StatusStreamTokenEvent,
} from "@/lib/status-stream";

type ReplayableStatusStreamEvent = StatusStreamStatusEvent | StatusStreamTokenEvent;

interface BufferedStatusStreamEvent {
  event: ReplayableStatusStreamEvent;
  capturedAt: number;
  dedupeKey: string | null;
}

function replayableEvent(event: StatusStreamEvent): ReplayableStatusStreamEvent | null {
  if (event.type !== "status" && event.type !== "assistant_token") return null;
  const sessionId = typeof event.sessionId === "string" ? event.sessionId.trim() : "";
  return sessionId ? { ...event, sessionId } : null;
}

function eventDedupeKey(event: ReplayableStatusStreamEvent): string | null {
  const sequence = typeof event.sequence === "number" && event.sequence > 0 ? event.sequence : 0;
  if (!sequence) return null;
  return `${event.sessionId}\u0000${event.runId || ""}\u0000${sequence}`;
}

export class StatusStreamReplayBuffer {
  private readonly entries: BufferedStatusStreamEvent[] = [];
  private readonly dedupeKeys = new Set<string>();

  constructor(
    private readonly maxEvents = 2000,
    private readonly staleMs = 15 * 60 * 1000
  ) {}

  record(event: StatusStreamEvent, capturedAt = Date.now()): void {
    this.prune(capturedAt);
    const replayable = replayableEvent(event);
    if (!replayable) return;
    const dedupeKey = eventDedupeKey(replayable);
    if (dedupeKey && this.dedupeKeys.has(dedupeKey)) return;
    this.entries.push({ event: replayable, capturedAt, dedupeKey });
    if (dedupeKey) this.dedupeKeys.add(dedupeKey);
    while (this.entries.length > this.maxEvents) this.removeFirst();
  }

  consume(now = Date.now()): ReplayableStatusStreamEvent[] {
    this.prune(now);
    const events = this.entries.map(({ event }) => ({ ...event }));
    this.entries.length = 0;
    this.dedupeKeys.clear();
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

const sharedStatusStreamReplayBuffer = new StatusStreamReplayBuffer();

export function recordStatusStreamReplayEvent(event: StatusStreamEvent): void {
  sharedStatusStreamReplayBuffer.record(event);
}

export function consumeStatusStreamReplayEvents(): ReplayableStatusStreamEvent[] {
  return sharedStatusStreamReplayBuffer.consume();
}
