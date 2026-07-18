import { describe, expect, test } from "bun:test";
import { readRequestText, RequestBodyTooLargeError } from "../../src/api/request-body";

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
});
