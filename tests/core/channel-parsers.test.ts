import { describe, expect, test } from "bun:test";
import {
  parseIrcLine,
  parsePrivmsg,
  nickFromPrefix,
  isPing,
} from "../../src/core/channels/irc-protocol";
import { parseNtfyLine } from "../../src/core/channels/adapters/ntfy";
import { parseMattermostEvent, websocketUrl } from "../../src/core/channels/mattermost-events";

describe("IRC protocol parsing", () => {
  test("parses a PRIVMSG with prefix and trailing", () => {
    const line = parseIrcLine(":alice!user@host PRIVMSG #room :hello world");
    expect(line).toEqual({
      prefix: "alice!user@host",
      command: "PRIVMSG",
      params: ["#room", "hello world"],
    });
    expect(parsePrivmsg(line!)).toEqual({
      senderNick: "alice",
      target: "#room",
      text: "hello world",
    });
  });

  test("nick extraction", () => {
    expect(nickFromPrefix("bob!b@h")).toBe("bob");
    expect(nickFromPrefix("irc.server")).toBe("irc.server");
    expect(nickFromPrefix(null)).toBe("");
  });

  test("PING detection", () => {
    expect(isPing(parseIrcLine("PING :tok123")!)).toBe("tok123");
    expect(isPing(parseIrcLine("PRIVMSG #x :hi")!)).toBeNull();
  });

  test("numeric welcome command", () => {
    expect(parseIrcLine(":server 001 mynick :Welcome")?.command).toBe("001");
  });

  test("ignores blank lines", () => {
    expect(parseIrcLine("")).toBeNull();
    expect(parseIrcLine("\r\n")).toBeNull();
  });
});

describe("ntfy event parsing", () => {
  test("parses a JSON event line", () => {
    expect(parseNtfyLine('{"event":"message","message":"hi","id":"a1"}')).toEqual({
      event: "message",
      message: "hi",
      id: "a1",
    });
  });

  test("returns null for blank/garbage", () => {
    expect(parseNtfyLine("")).toBeNull();
    expect(parseNtfyLine("not json")).toBeNull();
  });
});

describe("mattermost event parsing", () => {
  const SELF = "bot123";

  test("extracts a posted message from another user", () => {
    const ev = JSON.stringify({
      event: "posted",
      data: { post: JSON.stringify({ id: "p1", channel_id: "c1", user_id: "u1", message: "yo" }) },
    });
    expect(parseMattermostEvent(ev, SELF)).toEqual({
      channelId: "c1",
      userId: "u1",
      message: "yo",
      postId: "p1",
    });
  });

  test("ignores own posts and non-posted events", () => {
    const own = JSON.stringify({
      event: "posted",
      data: { post: JSON.stringify({ channel_id: "c1", user_id: SELF, message: "mine" }) },
    });
    expect(parseMattermostEvent(own, SELF)).toBeNull();
    expect(parseMattermostEvent(JSON.stringify({ event: "typing" }), SELF)).toBeNull();
    expect(parseMattermostEvent("garbage", SELF)).toBeNull();
  });

  test("websocket URL derivation", () => {
    expect(websocketUrl("https://mm.example.com")).toBe("wss://mm.example.com/api/v4/websocket");
    expect(websocketUrl("http://localhost:8065/")).toBe("ws://localhost:8065/api/v4/websocket");
  });
});
