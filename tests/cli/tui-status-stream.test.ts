import { afterEach, describe, expect, test } from "bun:test";
import {
  consumeTUIStatusStream,
  parseTUIStatusEvent,
  reconcileTUIStreamingText,
  type TUIStatusStreamEvent,
} from "../../src/cli/tui/status-stream";

const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

describe("CLI TUI status stream", () => {
  test("validates status, token, and snapshot events", () => {
    expect(
      parseTUIStatusEvent(
        JSON.stringify({
          type: "status",
          status: "tool_executing",
          timestamp: 1,
          sessionId: "session-1",
          toolName: "read",
          toolCallId: "call-1",
          toolPhase: "start",
          pendingChatId: "pending-1",
          clientPendingId: "optimistic-1",
        })
      )
    ).toEqual({
      type: "status",
      status: "tool_executing",
      timestamp: 1,
      detail: undefined,
      sessionId: "session-1",
      agentId: undefined,
      toolName: "read",
      toolCallId: "call-1",
      toolPhase: "start",
      pendingChatId: "pending-1",
      clientPendingId: "optimistic-1",
    });
    expect(
      parseTUIStatusEvent(
        JSON.stringify({
          type: "assistant_token",
          sessionId: "session-1",
          delta: "Hi",
          timestamp: 2,
        })
      )
    ).toEqual({ type: "assistant_token", sessionId: "session-1", delta: "Hi", timestamp: 2 });
    expect(
      parseTUIStatusEvent(
        JSON.stringify({
          type: "snapshot",
          timestamp: 3,
          activeSessions: [
            {
              sessionId: "session-1",
              status: "thinking",
              activities: [
                { id: "activity-1", phase: "result", text: "Explored file.ts", timestamp: 2 },
              ],
            },
          ],
        })
      )
    ).toEqual({
      type: "snapshot",
      timestamp: 3,
      activeSessions: [
        {
          sessionId: "session-1",
          status: "thinking",
          detail: undefined,
          activities: [
            {
              id: "activity-1",
              phase: "result",
              text: "Explored file.ts",
              timestamp: 2,
              toolName: undefined,
              toolCallId: undefined,
            },
          ],
        },
      ],
    });
  });

  test("rejects malformed and unsupported events", () => {
    expect(parseTUIStatusEvent("not-json")).toBeNull();
    expect(parseTUIStatusEvent(JSON.stringify({ type: "task_completed" }))).toBeNull();
    expect(
      parseTUIStatusEvent(JSON.stringify({ type: "status", status: "unknown", timestamp: 1 }))
    ).toBeNull();
    expect(
      parseTUIStatusEvent(
        JSON.stringify({ type: "assistant_token", sessionId: "session-1", timestamp: 1 })
      )
    ).toBeNull();
  });

  test("clears partial assistant text when a snapshot no longer includes the chat", () => {
    const snapshot = {
      type: "snapshot" as const,
      timestamp: 4,
      activeSessions: [],
    };

    expect(reconcileTUIStreamingText("partial response", snapshot, "session-1")).toBe("");
    expect(
      reconcileTUIStreamingText(
        "partial response",
        {
          ...snapshot,
          activeSessions: [{ sessionId: "session-1", status: "thinking", activities: [] }],
        },
        "session-1"
      )
    ).toBe("partial response");
  });

  test("consumes authenticated SSE blocks in delivery order", async () => {
    let authorization = "";
    let gatewayPassword = "";
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        authorization = request.headers.get("authorization") || "";
        gatewayPassword = request.headers.get("x-cybara-gateway-password") || "";
        return new Response(
          [
            'data: {"type":"status","status":"thinking","timestamp":1,"sessionId":"s1"}',
            "",
            'data: {"type":"assistant_token","sessionId":"s1","delta":"Hello","timestamp":2}',
            "",
            "",
          ].join("\n"),
          { headers: { "Content-Type": "text/event-stream" } }
        );
      },
    });
    servers.push(server);
    const events: TUIStatusStreamEvent[] = [];
    await consumeTUIStatusStream({
      apiBase: server.url.origin,
      apiKey: "secret",
      gatewayPassword: "gateway-secret",
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    });

    expect(authorization).toBe("Bearer secret");
    expect(gatewayPassword).toBe("gateway-secret");
    expect(events.map((event) => event.type)).toEqual(["status", "assistant_token"]);
  });
});
