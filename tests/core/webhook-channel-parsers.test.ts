import { describe, expect, test } from "bun:test";
import { parseGoogleChatEvent } from "../../src/core/channels/googlechat-events";
import { parseSynologyForm } from "../../src/core/channels/synology-events";

describe("Google Chat event parsing", () => {
  test("extracts a MESSAGE event", () => {
    const body = {
      type: "MESSAGE",
      message: { text: "hello", sender: { name: "users/1" }, space: { name: "spaces/AAA" } },
    };
    expect(parseGoogleChatEvent(body)).toEqual({
      space: "spaces/AAA",
      sender: "users/1",
      text: "hello",
    });
  });

  test("falls back to top-level space", () => {
    const body = { type: "MESSAGE", message: { text: "hi" }, space: { name: "spaces/B" } };
    expect(parseGoogleChatEvent(body)?.space).toBe("spaces/B");
  });

  test("ignores non-MESSAGE and empty text", () => {
    expect(parseGoogleChatEvent({ type: "ADDED_TO_SPACE" })).toBeNull();
    expect(parseGoogleChatEvent({ type: "MESSAGE", message: { text: "  " } })).toBeNull();
    expect(parseGoogleChatEvent(null)).toBeNull();
  });
});

describe("Synology Chat form parsing", () => {
  test("parses outgoing webhook form fields", () => {
    const raw = "token=abc&user_id=42&username=carsen&text=hey+there";
    expect(parseSynologyForm(raw)).toEqual({
      token: "abc",
      userId: "42",
      username: "carsen",
      text: "hey there",
    });
  });

  test("returns null without text", () => {
    expect(parseSynologyForm("token=abc&user_id=42")).toBeNull();
    expect(parseSynologyForm("")).toBeNull();
  });
});
