import { describe, expect, test } from "bun:test";
import type {
  MobileStatusStreamEvent,
  MobileStatusStreamOptions,
} from "../../apps/mobile/src/lib/api-types";
import {
  MobileStatusReplayBuffer,
  MobileStatusStreamClient,
} from "../../apps/mobile/src/lib/mobileStatusStream";

class FakeMobileWebSocket {
  static instances: FakeMobileWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  closed = false;

  constructor(
    readonly url: string,
    readonly protocols?: string | string[]
  ) {
    FakeMobileWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  emit(event: MobileStatusStreamEvent): void {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
}

function normalizeEvent(value: unknown): MobileStatusStreamEvent | null {
  if (!value || typeof value !== "object" || !("type" in value)) return null;
  return value as MobileStatusStreamEvent;
}

function streamOptions(overrides: MobileStatusStreamOptions = {}): MobileStatusStreamOptions {
  return {
    closeGraceMs: 50,
    heartbeatMs: 0,
    reconnectDelayMs: 50,
    WebSocketImpl: FakeMobileWebSocket,
    ...overrides,
  };
}

describe("mobile status stream", () => {
  test("bounds, deduplicates, and expires replay events", () => {
    const buffer = new MobileStatusReplayBuffer(2, 100);
    const first: MobileStatusStreamEvent = {
      type: "status",
      sessionId: "s1",
      runId: "r1",
      sequence: 1,
      status: "thinking",
      timestamp: 1,
    };
    buffer.record(first, 1);
    buffer.record(first, 2);
    buffer.record({ ...first, sequence: 2, timestamp: 2 }, 2);
    buffer.record({ ...first, sequence: 3, timestamp: 3 }, 3);

    expect(buffer.size).toBe(2);
    expect(buffer.consume(4).map((event) => event.sequence)).toEqual([2, 3]);
    buffer.record({ ...first, sequence: 4 }, 10);
    expect(buffer.consume(111)).toEqual([]);
  });

  test("shares one socket and replays events received between chat screens", () => {
    FakeMobileWebSocket.instances = [];
    const client = new MobileStatusStreamClient(() => "ws://gateway/status", normalizeEvent);
    const firstEvents: MobileStatusStreamEvent[] = [];
    const secondEvents: MobileStatusStreamEvent[] = [];
    let secondOpened = false;
    const disconnectFirst = client.subscribe(
      { onEvent: (event) => firstEvents.push(event) },
      streamOptions()
    );
    const socket = FakeMobileWebSocket.instances[0];
    socket?.open();
    socket?.emit({
      type: "status",
      sessionId: "s1",
      sequence: 1,
      status: "thinking",
      timestamp: 1,
    });
    disconnectFirst();
    socket?.emit({
      type: "assistant_token",
      sessionId: "s2",
      sequence: 2,
      delta: "live",
      timestamp: 2,
    });

    const disconnectSecond = client.subscribe(
      {
        onEvent: (event) => secondEvents.push(event),
        onOpen: () => {
          secondOpened = true;
        },
      },
      streamOptions({ closeGraceMs: 0, replayBufferedEvents: true })
    );

    expect(FakeMobileWebSocket.instances).toHaveLength(1);
    expect(secondOpened).toBe(true);
    expect(firstEvents).toHaveLength(1);
    expect(secondEvents).toEqual([
      {
        type: "assistant_token",
        sessionId: "s2",
        sequence: 2,
        delta: "live",
        timestamp: 2,
      },
    ]);
    disconnectSecond();
    expect(socket?.closed).toBe(true);
  });

  test("replaying one chat retains buffered events for another chat", () => {
    const buffer = new MobileStatusReplayBuffer();
    const event = (sessionId: string, sequence: number): MobileStatusStreamEvent => ({
      type: "assistant_token",
      sessionId,
      sequence,
      delta: sessionId,
      timestamp: sequence,
    });
    buffer.record(event("s1", 1), 1);
    buffer.record(event("s2", 2), 2);

    expect(buffer.consume(3, "s1")).toEqual([event("s1", 1)]);
    expect(buffer.size).toBe(1);
    expect(buffer.consume(3, "s2")).toEqual([event("s2", 2)]);
    expect(buffer.size).toBe(0);
  });

  test("session subscribers consume only their buffered events from the shared socket", () => {
    FakeMobileWebSocket.instances = [];
    const client = new MobileStatusStreamClient(() => "ws://gateway/status", normalizeEvent);
    const firstEvents: MobileStatusStreamEvent[] = [];
    const secondEvents: MobileStatusStreamEvent[] = [];
    const disconnectInitial = client.subscribe({ onEvent: () => {} }, streamOptions());
    const socket = FakeMobileWebSocket.instances[0];
    socket?.open();
    disconnectInitial();
    socket?.emit({
      type: "assistant_token",
      sessionId: "s1",
      sequence: 1,
      delta: "first",
      timestamp: 1,
    });
    socket?.emit({
      type: "assistant_token",
      sessionId: "s2",
      sequence: 2,
      delta: "second",
      timestamp: 2,
    });

    const disconnectFirst = client.subscribe(
      { onEvent: (event) => firstEvents.push(event) },
      streamOptions({ replayBufferedEvents: true, replaySessionId: "s1" })
    );
    const disconnectSecond = client.subscribe(
      { onEvent: (event) => secondEvents.push(event) },
      streamOptions({ closeGraceMs: 0, replayBufferedEvents: true, replaySessionId: "s2" })
    );

    expect(FakeMobileWebSocket.instances).toHaveLength(1);
    expect(firstEvents).toEqual([
      {
        type: "assistant_token",
        sessionId: "s1",
        sequence: 1,
        delta: "first",
        timestamp: 1,
      },
    ]);
    expect(secondEvents).toEqual([
      {
        type: "assistant_token",
        sessionId: "s2",
        sequence: 2,
        delta: "second",
        timestamp: 2,
      },
    ]);
    disconnectFirst();
    disconnectSecond();
    expect(socket?.closed).toBe(true);
  });

  test("reconnects an unexpectedly closed active stream", async () => {
    FakeMobileWebSocket.instances = [];
    const client = new MobileStatusStreamClient(() => "ws://gateway/status", normalizeEvent);
    const disconnect = client.subscribe({ onEvent: () => {} }, streamOptions({ closeGraceMs: 0 }));
    FakeMobileWebSocket.instances[0]?.open();
    FakeMobileWebSocket.instances[0]?.close();

    await Bun.sleep(65);

    expect(FakeMobileWebSocket.instances).toHaveLength(2);
    disconnect();
  });
});
