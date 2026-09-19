function extractLlmErrorDetail(message: string): string | undefined {
  const afterDash = message.replace(/^API error[^:]*:\s*\d+\s*-\s*/i, "");
  const candidate = afterDash !== message ? afterDash : message;
  const trimmed = candidate.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: { message?: unknown; code?: unknown } | string;
        message?: unknown;
        detail?: unknown;
      };
      const errObj = typeof parsed.error === "object" ? parsed.error : undefined;
      const detail =
        (errObj && typeof errObj.message === "string" && errObj.message) ||
        (typeof parsed.error === "string" && parsed.error) ||
        (typeof parsed.message === "string" && parsed.message) ||
        (typeof parsed.detail === "string" && parsed.detail) ||
        "";
      if (detail) return detail.replace(/\s+/g, " ").slice(0, 300);
    } catch {}
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 300);
}

export interface LlmFailureContext {
  authType?: string;
  providerName?: string;
  baseUrl?: string | null;
  platform?: NodeJS.Platform;
}

const CONNECTION_FAILURE_PATTERN =
  /was there a typo in the url or port|unable to connect|econnrefused|ehostunreach|enetunreach|ehostdown|connectionrefused|failedtoopensocket|connection refused|host is unreachable|network is unreachable/i;

function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.startsWith("127.") || host === "::1") return false;
  if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return true;
  if (!host.includes(".") && !host.includes(":")) return true;
  const octets = host.split(".").map(Number);
  if (
    octets.length === 4 &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [first, second] = octets;
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  }
  return /^(fe8|fe9|fea|feb|fc|fd)/.test(host);
}

export function describeProviderConnectionFailure(
  message: string,
  context: { baseUrl?: string | null; providerName?: string; platform?: NodeJS.Platform }
): string | undefined {
  if (!CONNECTION_FAILURE_PATTERN.test(message) || !context.baseUrl) return undefined;
  let target: URL;
  try {
    target = new URL(context.baseUrl);
  } catch {
    return undefined;
  }
  const name = context.providerName?.trim() || "the provider";
  const address = target.host;
  if ((context.platform ?? process.platform) === "darwin" && isLocalNetworkHost(target.hostname)) {
    return `Couldn't connect to ${name} at ${address}. If that server is running, macOS may be blocking Cybara from your local network: open System Settings → Privacy & Security → Local Network, turn on Cybara, then quit and reopen Cybara.`;
  }
  return `Couldn't connect to ${name} at ${address}. Check that the server is running and reachable from this machine, and that the provider's base URL and port are correct.`;
}

export function formatLlmFailure(error: unknown, context?: LlmFailureContext): string {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : String(error || "");
  const lower = message.toLowerCase();
  const extractedStatus = (() => {
    const match = /api error[^:]*:\s*(\d{3})/i.exec(message);
    return match ? Number(match[1]) : undefined;
  })();

  if (lower.includes("invalid_api_key") || lower.includes("incorrect api key")) {
    return "OpenAI API key was rejected. Update your OpenAI provider key in Providers.";
  }
  if (lower.includes("openai codex oauth provider")) {
    return "This model requires OpenAI Codex OAuth. Configure an OpenAI Codex provider and try again.";
  }
  if (lower.includes("model_not_found") || lower.includes("does not exist")) {
    return "Configured model is not available for this provider. Select another model and try again.";
  }
  if (/monthly usage limit|usage limit.{0,40}billing cycle/.test(lower)) {
    return "Provider monthly usage quota reached. Wait for the billing-cycle reset, enable extra usage when supported, or use another account/provider.";
  }
  if (/usage limit.{0,40}(?:period|rolling)|reached.{0,40}usage limit/.test(lower)) {
    return "Provider rolling usage window reached. Wait for the reset shown in Usage, enable extra usage when supported, or use another account/provider.";
  }
  if (lower.includes("insufficient_quota") || lower.includes("quota")) {
    return "Provider quota/billing limit reached. Update billing or use a different provider.";
  }
  if (lower.includes("402") || lower.includes("membership") || lower.includes("payment required")) {
    return "Provider billing/membership inactive (402). Check your provider account's subscription or credits.";
  }
  if (lower.includes("401")) {
    if (context?.authType === "oauth") {
      const providerName = context.providerName?.trim() || "Provider";
      return `${providerName} sign-in expired (401). Reconnect the provider in Settings and retry.`;
    }
    return "Provider authentication failed (401). Verify your provider API key/token.";
  }
  if (lower.includes("403")) {
    const detail = extractLlmErrorDetail(message);
    if (detail && !/^\d+$/.test(detail) && detail.toLowerCase() !== "forbidden") {
      return `Provider rejected access (403): ${detail}`;
    }
    return "Provider rejected access (403). Verify account permissions and model access.";
  }
  if (lower.includes("too many requests")) {
    return "Provider concurrent-request limit remained active after automatic retries. Wait briefly or use another account/provider.";
  }
  if (lower.includes("overloaded")) {
    return "Provider remained overloaded after automatic retries. Wait briefly or use another provider.";
  }
  if (lower.includes("429") || lower.includes("rate limit")) {
    return "Provider rate limit remained active after automatic retries. Wait briefly or use another account/provider.";
  }

  const connectionFailure = describeProviderConnectionFailure(message, {
    baseUrl: context?.baseUrl,
    providerName: context?.providerName,
    platform: context?.platform,
  });
  if (connectionFailure) return connectionFailure;

  const detail = extractLlmErrorDetail(message);
  if (lower.includes("400") || lower.includes("unsupported") || lower.includes("invalid")) {
    const status = extractedStatus ?? 400;
    return detail
      ? `Provider rejected the request (${status}): ${detail}`
      : `Provider rejected the request (${status}). The model may not support a sent parameter.`;
  }
  if (lower.includes("404")) {
    return detail
      ? `Provider endpoint/model not found (404): ${detail}`
      : "Provider endpoint or model not found (404). Verify the model id and base URL.";
  }
  if (lower.includes("5") && /\b5\d\d\b/.test(message)) {
    return detail
      ? `Provider server error: ${detail}`
      : "Provider had a server error (5xx). Retry shortly or switch providers.";
  }
  if (detail) {
    return `The provider request failed: ${detail}`;
  }
  return "I apologize, but I encountered an issue processing your request. Please try again or rephrase your message.";
}
