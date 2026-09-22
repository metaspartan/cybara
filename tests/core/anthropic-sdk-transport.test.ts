import { describe, expect, test } from "bun:test";
import {
  postAnthropicMessages,
  usesAnthropicSdk,
} from "../../src/core/llm/anthropic-sdk-transport";

interface RecordedRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function recordingFetch(respond: () => Response | Promise<Response>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return await respond();
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const messageBody = {
  model: "claude-opus-5-5",
  max_tokens: 128000,
  messages: [{ role: "user", content: "hello" }],
  output_config: { effort: "high" },
};

function requestInit(headers: Record<string, string>, signal?: AbortSignal) {
  return {
    method: "POST" as const,
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", ...headers },
    body: JSON.stringify(messageBody),
    signal,
  };
}

describe("Anthropic SDK transport", () => {
  test("uses the SDK only for first-party Anthropic API key requests", () => {
    const apiKey = { "x-api-key": "sk-ant-test" };
    expect(usesAnthropicSdk("https://api.anthropic.com/v1", "/messages", apiKey)).toBe(true);
    expect(usesAnthropicSdk("https://api.anthropic.com/v1/", "/messages", apiKey)).toBe(true);
    expect(usesAnthropicSdk("https://api.minimax.io/anthropic/v1", "/messages", apiKey)).toBe(
      false
    );
    expect(
      usesAnthropicSdk("https://api.anthropic.com/v1", "/messages", { authorization: "Bearer t" })
    ).toBe(false);
    expect(
      usesAnthropicSdk("https://api.anthropic.com/v1", "/claude-opus-5:rawPredict", apiKey)
    ).toBe(false);
  });

  test("sends first-party requests through the SDK with the key, headers, and body intact", async () => {
    const { fetchImpl, requests } = recordingFetch(() =>
      Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 3, output_tokens: 1 },
      })
    );

    const response = await postAnthropicMessages(
      "https://api.anthropic.com/v1",
      "/messages",
      requestInit({ "x-api-key": "sk-ant-test", "anthropic-beta": "context-1m-2025-08-07" }),
      fetchImpl
    );

    expect(response.ok).toBe(true);
    expect(((await response.json()) as { id: string }).id).toBe("msg_1");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(requests[0].headers.get("x-api-key")).toBe("sk-ant-test");
    expect(requests[0].headers.get("authorization")).toBeNull();
    expect(requests[0].headers.get("anthropic-version")).toBe("2023-06-01");
    expect(requests[0].headers.get("anthropic-beta")).toBe("context-1m-2025-08-07");
    expect(requests[0].body).toEqual(messageBody);
  });

  test("returns provider errors as responses so existing retry handling still applies", async () => {
    const rateLimited = recordingFetch(
      () =>
        new Response(
          JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow" } }),
          { status: 429, headers: { "retry-after": "7", "content-type": "application/json" } }
        )
    );
    const limited = await postAnthropicMessages(
      "https://api.anthropic.com/v1",
      "/messages",
      requestInit({ "x-api-key": "sk-ant-test" }),
      rateLimited.fetchImpl
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("7");
    expect(await limited.text()).toContain("rate_limit_error");
    expect(rateLimited.requests).toHaveLength(1);

    const rejected = recordingFetch(
      () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: 'tool_choice: type "tool" and "any" are not supported for this model.',
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        )
    );
    const badRequest = await postAnthropicMessages(
      "https://api.anthropic.com/v1",
      "/messages",
      requestInit({ "x-api-key": "sk-ant-test" }),
      rejected.fetchImpl
    );
    expect(badRequest.status).toBe(400);
    expect(await badRequest.text()).toContain("not supported for this model");
  });

  test("surfaces connection failures and aborts with their original error types", async () => {
    const offline = recordingFetch(() => {
      throw new TypeError("Unable to connect. Is the computer able to access the url?");
    });
    await expect(
      postAnthropicMessages(
        "https://api.anthropic.com/v1",
        "/messages",
        requestInit({ "x-api-key": "sk-ant-test" }),
        offline.fetchImpl
      )
    ).rejects.toThrow("Unable to connect");

    const controller = new AbortController();
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
    const aborted = recordingFetch(() => {
      throw new DOMException("aborted", "AbortError");
    });
    const failure = await postAnthropicMessages(
      "https://api.anthropic.com/v1",
      "/messages",
      requestInit({ "x-api-key": "sk-ant-test" }, controller.signal),
      aborted.fetchImpl
    ).catch((error: unknown) => error);
    expect((failure as { name?: string }).name).toBe("TimeoutError");
  });

  test("leaves Anthropic-compatible providers and OAuth on plain fetch", async () => {
    for (const [baseUrl, headers] of [
      ["https://api.minimax.io/anthropic/v1", { "x-api-key": "mm-key" }],
      ["https://api.anthropic.com/v1", { authorization: "Bearer oauth-token" }],
    ] as const) {
      const { fetchImpl, requests } = recordingFetch(() => Response.json({ ok: true }));
      const init = requestInit(headers);
      const response = await postAnthropicMessages(baseUrl, "/messages", init, fetchImpl);
      expect(response.ok).toBe(true);
      expect(requests[0].url).toBe(`${baseUrl}/messages`);
      expect(requests[0].body).toEqual(messageBody);
    }
  });
});
