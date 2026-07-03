import { describe, expect, test } from "bun:test";
import {
  parseSyncMessages,
  buildLoginBody,
  sendEventPath,
  normalizeHomeserverUrl,
} from "../../src/core/channels/matrix-sync";

const SELF = "@bot:example.org";

function syncWith(events: unknown[]): unknown {
  return {
    next_batch: "s2",
    rooms: { join: { "!room:example.org": { timeline: { events } } } },
  };
}

describe("matrix sync parsing", () => {
  test("extracts text messages from other users", () => {
    const sync = syncWith([
      {
        type: "m.room.message",
        sender: "@alice:example.org",
        event_id: "$1",
        content: { msgtype: "m.text", body: "hello" },
      },
    ]);
    const { nextBatch, messages } = parseSyncMessages(sync, SELF);
    expect(nextBatch).toBe("s2");
    expect(messages).toEqual([
      { roomId: "!room:example.org", sender: "@alice:example.org", body: "hello", eventId: "$1" },
    ]);
  });

  test("ignores own messages, non-text, and non-message events", () => {
    const sync = syncWith([
      { type: "m.room.message", sender: SELF, content: { msgtype: "m.text", body: "mine" } },
      {
        type: "m.room.message",
        sender: "@a:example.org",
        content: { msgtype: "m.image", body: "pic" },
      },
      { type: "m.room.member", sender: "@a:example.org", content: {} },
      {
        type: "m.room.message",
        sender: "@a:example.org",
        content: { msgtype: "m.text", body: "   " },
      },
    ]);
    expect(parseSyncMessages(sync, SELF).messages).toEqual([]);
  });

  test("ignoreInitial returns next_batch but no messages", () => {
    const sync = syncWith([
      {
        type: "m.room.message",
        sender: "@a:example.org",
        content: { msgtype: "m.text", body: "x" },
      },
    ]);
    const r = parseSyncMessages(sync, SELF, { ignoreInitial: true });
    expect(r.nextBatch).toBe("s2");
    expect(r.messages).toEqual([]);
  });

  test("handles empty/garbage sync", () => {
    expect(parseSyncMessages(null, SELF)).toEqual({ nextBatch: null, messages: [] });
    expect(parseSyncMessages({}, SELF)).toEqual({ nextBatch: null, messages: [] });
  });

  test("login body shape", () => {
    expect(buildLoginBody("@bot:example.org", "pw")).toEqual({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: "@bot:example.org" },
      password: "pw",
    });
  });

  test("send event path encodes room + txn", () => {
    expect(sendEventPath("!r:ex.org", "cybara-1")).toBe(
      "/_matrix/client/v3/rooms/!r%3Aex.org/send/m.room.message/cybara-1"
    );
  });

  test("homeserver URL normalization", () => {
    expect(normalizeHomeserverUrl("matrix.org")).toBe("https://matrix.org");
    expect(normalizeHomeserverUrl("https://m.example.org/")).toBe("https://m.example.org");
    expect(normalizeHomeserverUrl("http://localhost:8008")).toBe("http://localhost:8008");
    expect(normalizeHomeserverUrl("  ")).toBe("");
  });
});
