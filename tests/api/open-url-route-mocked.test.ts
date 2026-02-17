import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const openUrlState = {
  openedUrls: [] as string[],
  shouldThrow: false,
};

mock.module("../../src/core/runtime/open-url", () => ({
  openUrlInBrowser: async (url: string) => {
    openUrlState.openedUrls.push(url);
    if (openUrlState.shouldThrow) {
      throw new Error("open-url mock failure");
    }
  },
}));

let handleRequest: (req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}) => Promise<{ status: number; headers: Record<string, string>; body?: unknown }>;

async function api(method: string, path: string, body?: unknown) {
  return await handleRequest({
    method,
    url: `http://localhost:4269${path}`,
    headers: { host: "localhost:4269" },
    body,
  });
}

describe("Open URL route contracts (mocked runtime opener)", () => {
  beforeAll(async () => {
    const routes = await import("../../src/api/routes");
    handleRequest = routes.handleRequest;
  });

  beforeEach(() => {
    openUrlState.openedUrls = [];
    openUrlState.shouldThrow = false;
  });

  test("POST /api/open-url accepts valid https URLs and delegates to opener", async () => {
    const res = await api("POST", "/api/open-url", {
      url: "https://example.com/docs?ref=cybara",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(openUrlState.openedUrls).toEqual(["https://example.com/docs?ref=cybara"]);
  });

  test("POST /api/open-url blocks local/private destinations before opener is called", async () => {
    const res = await api("POST", "/api/open-url", {
      url: "http://localhost:4269/secret",
    });

    expect(res.status).toBe(400);
    expect((res.body as { code?: string }).code).toBe("VALIDATION_ERROR");
    expect(openUrlState.openedUrls).toEqual([]);
  });

  test("POST /api/open-url returns internal error when opener fails and preserves rate-limit headers", async () => {
    openUrlState.shouldThrow = true;

    const res = await api("POST", "/api/open-url", { url: "https://example.com/fail" });

    expect(res.status).toBe(500);
    expect((res.body as { code?: string }).code).toBe("INTERNAL_ERROR");
    expect(res.headers["X-RateLimit-Remaining"]).toBeDefined();
    expect(res.headers["X-RateLimit-Reset"]).toBeDefined();
    expect(openUrlState.openedUrls).toEqual(["https://example.com/fail"]);
  });
});
