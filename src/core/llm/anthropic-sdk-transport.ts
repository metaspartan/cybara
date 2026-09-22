import Anthropic from "@anthropic-ai/sdk";
import { resolveNonStreamingCeilingMs } from "./request-timeout";

const FIRST_PARTY_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const FIRST_PARTY_ANTHROPIC_ORIGIN = "https://api.anthropic.com";
const SDK_MANAGED_HEADERS = new Set(["x-api-key", "authorization", "content-length"]);

export interface AnthropicRequestInit {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export type AnthropicFetch = (url: string, init: AnthropicRequestInit) => Promise<Response>;

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").toLowerCase();
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  const value = match ? headers[match] : undefined;
  return value?.trim() ? value.trim() : undefined;
}

export function usesAnthropicSdk(
  baseUrl: string,
  endpoint: string,
  headers: Record<string, string>
): boolean {
  return (
    normalizedBaseUrl(baseUrl) === FIRST_PARTY_ANTHROPIC_BASE_URL &&
    endpoint === "/messages" &&
    headerValue(headers, "x-api-key") !== undefined &&
    headerValue(headers, "authorization") === undefined
  );
}

function forwardedHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => !SDK_MANAGED_HEADERS.has(key.toLowerCase()))
  );
}

function sdkErrorResponse(error: InstanceType<typeof Anthropic.APIError>): Response {
  const payload = error.error ?? { type: "error", error: { message: error.message } };
  return new Response(JSON.stringify(payload), {
    status: error.status ?? 500,
    headers: error.headers ?? undefined,
  });
}

export function createAnthropicSdkClient(apiKey: string, fetchImpl?: typeof fetch): Anthropic {
  return new Anthropic({
    apiKey,
    authToken: null,
    baseURL: FIRST_PARTY_ANTHROPIC_ORIGIN,
    maxRetries: 0,
    timeout: resolveNonStreamingCeilingMs(),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

export async function postAnthropicMessages(
  baseUrl: string,
  endpoint: string,
  init: AnthropicRequestInit,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  if (!usesAnthropicSdk(baseUrl, endpoint, init.headers)) {
    return await fetchImpl(`${baseUrl}${endpoint}`, init);
  }
  const client = createAnthropicSdkClient(headerValue(init.headers, "x-api-key")!, fetchImpl);
  const body = JSON.parse(init.body) as Anthropic.MessageCreateParamsNonStreaming;
  try {
    return await client.messages
      .create(body, {
        headers: forwardedHeaders(init.headers),
        signal: init.signal,
        timeout: resolveNonStreamingCeilingMs(),
        maxRetries: 0,
      })
      .asResponse();
  } catch (error) {
    if (init.signal?.aborted) throw init.signal.reason ?? error;
    if (error instanceof Anthropic.APIConnectionError) {
      throw error.cause instanceof Error ? error.cause : error;
    }
    if (error instanceof Anthropic.APIError && typeof error.status === "number") {
      return sdkErrorResponse(error);
    }
    throw error;
  }
}
