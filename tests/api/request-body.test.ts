import { describe, expect, test } from "bun:test";
import {
  classifyRequestBodyReadFailure,
  readRequestText,
  RequestBodyTooLargeError,
} from "../../src/api/request-body";

describe("bounded request body reader", () => {
  test("reads a body within the byte limit", async () => {
    const request = new Request("http://localhost/test", { method: "POST", body: "hello" });
    await expect(readRequestText(request, 5)).resolves.toBe("hello");
  });

  test("rejects an oversized declared body", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-length": "100" },
      body: "small",
    });
    await expect(readRequestText(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  test("rejects a streamed body that crosses the byte limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("1234"));
        controller.enqueue(new TextEncoder().encode("5678"));
        controller.close();
      },
    });
    const request = new Request("http://localhost/test", { method: "POST", body: stream });
    await expect(readRequestText(request, 7)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  test("classifies oversized bodies as client payload failures", () => {
    expect(classifyRequestBodyReadFailure(new RequestBodyTooLargeError(10))).toEqual({
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body is too large",
    });
  });

  test("classifies stream failures as server read errors", () => {
    expect(classifyRequestBodyReadFailure(new Error("stream disconnected"))).toEqual({
      status: 500,
      code: "REQUEST_BODY_READ_ERROR",
      message: "Unable to read request body",
    });
  });
});
