import { describe, expect, test } from "bun:test";
import { parseToolArguments } from "../../src/core/agent-internals";

describe("parseToolArguments — lenient repair", () => {
  test("passes through well-formed JSON strings and objects", () => {
    expect(parseToolArguments('{"path":"/tmp/x"}')).toEqual({ path: "/tmp/x" });
    expect(parseToolArguments({ path: "/tmp/x" })).toEqual({ path: "/tmp/x" });
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments(undefined)).toEqual({});
  });

  test("recovers args wrapped in a markdown code fence", () => {
    const raw = '```json\n{"query": "hello world"}\n```';
    expect(parseToolArguments(raw)).toEqual({ query: "hello world" });
  });

  test("recovers args surrounded by prose", () => {
    const raw = 'Here are the arguments: {"path": "/etc/hosts", "lines": 20} — done';
    expect(parseToolArguments(raw)).toEqual({ path: "/etc/hosts", lines: 20 });
  });

  test("tolerates trailing commas", () => {
    expect(parseToolArguments('{"a": 1, "b": 2,}')).toEqual({ a: 1, b: 2 });
    expect(parseToolArguments('{"items": [1, 2, 3,],}')).toEqual({ items: [1, 2, 3] });
  });

  test("does not corrupt braces that appear inside string values", () => {
    const raw = '{"content": "function f() { return {a:1}; }"}';
    expect(parseToolArguments(raw)).toEqual({ content: "function f() { return {a:1}; }" });
  });

  test("extracts the object from a truncated-then-recoverable payload", () => {
    const raw = 'prefix {"name": "test"} trailing junk that never closed {';
    expect(parseToolArguments(raw)).toEqual({ name: "test" });
  });

  test("returns empty object for unrecoverable garbage", () => {
    expect(parseToolArguments("not json at all")).toEqual({});
    expect(parseToolArguments("[1,2,3]")).toEqual({});
  });
});
