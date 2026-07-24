import { describe, expect, test } from "bun:test";
import {
  STATUS_STREAM_MAX_BUFFERED_BYTES,
  STATUS_STREAM_TOKEN_FLUSH_MS,
  type StatusStreamSocket,
  StatusStreamSender,
} from "../../src/core/status-stream-sender";

class TestStatusStreamSocket implements StatusStreamSocket {
  readonly messages: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  bufferedAmount = 0;

  send(data: string): void {
    this.messages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }

  getBufferedAmount(): number {
    return this.bufferedAmount;
  }
}

describe("status stream sender", () => {
  test("coalesces token bursts for one run into one websocket message", async () => {
    const socket = new TestStatusStreamSocket();
    const sender = new StatusStreamSender(socket, 5);
    for (const delta of ["one", " ", "two", " ", "three"]) {
      sender.send({
        type: "assistant_token",
        sessionId: "session-1",
        runId: "run-1",
        agentId: "agent-1",
        delta,
        timestamp: Date.now(),
      });
    }

    await Bun.sleep(10);

    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0] ?? "{}")).toMatchObject({
      type: "assistant_token",
      sessionId: "session-1",
      runId: "run-1",
      delta: "one two three",
    });
    sender.dispose();
  });

  test("flushes pending tokens before a status transition", () => {
    const socket = new TestStatusStreamSocket();
    const sender = new StatusStreamSender(socket, 100);
    sender.send({
      type: "assistant_token",
      sessionId: "session-1",
      runId: "run-1",
      delta: "done",
      timestamp: 1,
    });
    sender.send({
      type: "status",
      sessionId: "session-1",
      runId: "run-1",
      status: "idle",
      timestamp: 2,
    });

    expect(socket.messages.map((message) => JSON.parse(message).type)).toEqual([
      "assistant_token",
      "status",
    ]);
    sender.dispose();
  });

  test("closes a slow client before websocket buffering becomes unbounded", () => {
    const socket = new TestStatusStreamSocket();
    socket.bufferedAmount = STATUS_STREAM_MAX_BUFFERED_BYTES + 1;
    const sender = new StatusStreamSender(socket, STATUS_STREAM_TOKEN_FLUSH_MS);
    sender.send({
      type: "status",
      sessionId: "session-1",
      status: "thinking",
      timestamp: 1,
    });

    expect(socket.messages).toEqual([]);
    expect(socket.closes).toEqual([{ code: 1013, reason: "Status stream client fell behind" }]);
  });
});
