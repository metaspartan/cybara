import { describe, expect, test } from "bun:test";
import { LspMessageBuffer } from "../../src/core/lsp/message-buffer";

function frame(payload: object): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`), body]);
}

describe("LspMessageBuffer", () => {
  test("decodes fragmented Unicode messages without desynchronizing", () => {
    const decoder = new LspMessageBuffer();
    const first = frame({
      jsonrpc: "2.0",
      method: "window/logMessage",
      params: { message: "你好" },
    });
    const second = frame({ jsonrpc: "2.0", id: 2, result: { label: "ready" } });
    const combined = Buffer.concat([first, second]);
    const splitAt = first.byteLength - 2;

    expect(decoder.push(combined.subarray(0, splitAt))).toEqual([]);
    const messages = decoder.push(combined.subarray(splitAt));

    expect(messages.map((message) => JSON.parse(message))).toEqual([
      { jsonrpc: "2.0", method: "window/logMessage", params: { message: "你好" } },
      { jsonrpc: "2.0", id: 2, result: { label: "ready" } },
    ]);
  });

  test("skips malformed headers and resumes at the next framed message", () => {
    const decoder = new LspMessageBuffer();
    const valid = frame({ jsonrpc: "2.0", id: 1, result: null });
    const messages = decoder.push(Buffer.concat([Buffer.from("Invalid: 4\r\n\r\nnope"), valid]));

    expect(messages.map((message) => JSON.parse(message))).toEqual([
      { jsonrpc: "2.0", id: 1, result: null },
    ]);
  });
});
