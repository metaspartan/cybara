function extractLlmErrorDetail(message: string): string | undefined {
  const afterDash = message.replace(/^API error:\s*\d+\s*-\s*/i, "");
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
}

export function formatLlmFailure(error: unknown, context?: LlmFailureContext): string {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : String(error || "");
  const lower = message.toLowerCase();

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

  const detail = extractLlmErrorDetail(message);
  if (lower.includes("400") || lower.includes("unsupported") || lower.includes("invalid")) {
    return detail
      ? `Provider rejected the request (400): ${detail}`
      : "Provider rejected the request (400). The model may not support a sent parameter.";
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
