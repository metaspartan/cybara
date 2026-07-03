import { describe, expect, test } from "bun:test";
import { withRetry } from "../../src/core/retry";

function okResponse(body = "ok"): Response {
  return new Response(body, { status: 200 });
}
function rateLimitedResponse(): Response {
  return new Response("rate limited", { status: 429 });
}
function serverErrorResponse(): Response {
  return new Response("boom", { status: 502 });
}
function badRequestResponse(): Response {
  return new Response("nope", { status: 400 });
}

describe("withRetry", () => {
  test("returns immediately on a 200", async () => {
    const result = await withRetry(async () => okResponse(), null, {
      sleep: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
  });

  test("retries a transient 5xx and succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return calls < 3 ? serverErrorResponse() : okResponse();
      },
      null,
      { sleep: async () => {}, maxAttempts: 3 }
    );
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
  });

  test("gives up after maxAttempts on persistent 5xx", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return serverErrorResponse();
      },
      null,
      { sleep: async () => {}, maxAttempts: 2 }
    );
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.error?.category).toBe("server_error");
  });

  test("does not retry a 400 bad request", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return badRequestResponse();
      },
      null,
      { sleep: async () => {} }
    );
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
    expect(result.error?.category).toBe("bad_request");
  });

  test("retries a 429 (rate limit is retryable)", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return calls < 2 ? rateLimitedResponse() : okResponse();
      },
      null,
      { sleep: async () => {}, maxAttempts: 3 }
    );
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  test("rotates credential via onRotate on a 429", async () => {
    const used: (string | null)[] = [];
    let calls = 0;
    await withRetry(
      async (credential) => {
        used.push(credential);
        calls += 1;
        return calls < 2 ? rateLimitedResponse() : okResponse();
      },
      "key-1",
      {
        sleep: async () => {},
        onRotate: async () => "key-2",
        maxAttempts: 3,
      }
    );
    expect(used).toContain("key-1");
    expect(used).toContain("key-2");
  });

  test("retries on a thrown network error", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("fetch failed: ECONNRESET");
        return okResponse();
      },
      null,
      { sleep: async () => {}, maxAttempts: 3 }
    );
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  test("invokes onAttempt callback with attempt info", async () => {
    const attempts: Array<{ attempt: number; status?: number }> = [];
    await withRetry(async () => serverErrorResponse(), null, {
      sleep: async () => {},
      maxAttempts: 2,
      onAttempt: (info) => attempts.push({ attempt: info.attempt, status: info.status }),
    });
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts.every((a) => typeof a.status === "number")).toBe(true);
  });
});
