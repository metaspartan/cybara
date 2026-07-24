/**
 * Centralized LLM API error classification.
 *
 * Every provider adapter (Anthropic, OpenAI-compat, Google, Bedrock) previously
 * string-matched errors inline to decide retry vs. surface. This single
 * taxonomy replaces that duplication (DRY) and gives the credential pool and
 * retry layer a shared vocabulary to act on.
 */

export type ApiErrorCategory =
  | "auth"
  | "billing"
  | "rate_limit"
  | "overloaded"
  | "server_error"
  | "timeout"
  | "context_too_long"
  | "bad_request"
  | "network"
  | "unknown";

export interface ClassifiedApiError {
  category: ApiErrorCategory;
  /** True if the error might resolve on retry (transient). */
  retryable: boolean;
  /** True if rotating to a different credential is likely to help. */
  rotateCredential: boolean;
  /** True if compressing/reducing context is the appropriate response. */
  reduceContext: boolean;
  status?: number;
  message: string;
}

/** Whether an HTTP status suggests a transient, retryable failure. */
export function isTransientStatus(status: number): boolean {
  return [429, 500, 502, 503, 520, 529].includes(status);
}

/**
 * Classify an error from a provider HTTP response or thrown error.
 * Accepts either an HTTP status code + body text, or a raw Error/message.
 */
export function classifyApiError(input: {
  status?: number;
  body?: string;
  error?: unknown;
}): ClassifiedApiError {
  const status = input.status;
  const text =
    `${input.body ?? ""} ${(input.error as Error)?.message ?? String(input.error ?? "")}`.toLowerCase();
  const message = text.trim() || (status ? `HTTP ${status}` : "unknown error");

  // Auth
  if (
    status === 401 ||
    status === 403 ||
    /invalid_api_key|unauthorized|forbidden|authentication/.test(text)
  ) {
    return {
      category: "auth",
      retryable: false,
      rotateCredential: true,
      reduceContext: false,
      status,
      message,
    };
  }
  // Billing / quota
  if (
    status === 402 ||
    /billing|quota|insufficient|payment|exceeded.*limit|credit|reached.{0,40}(?:usage|monthly).{0,20}limit|usage limit.{0,40}(?:period|billing cycle)|monthly usage limit/.test(
      text
    )
  ) {
    return {
      category: "billing",
      retryable: false,
      rotateCredential: true,
      reduceContext: false,
      status,
      message,
    };
  }
  if (
    /temporarily overloaded|service (?:is )?overloaded|overloaded.{0,80}(?:retry|try again)|["']?code["']?\s*[:=]\s*1305/.test(
      text
    )
  ) {
    return {
      category: "overloaded",
      retryable: true,
      rotateCredential: false,
      reduceContext: false,
      status,
      message,
    };
  }
  // Rate limit
  if (status === 429 || /rate.?limit|too many requests|429/.test(text)) {
    return {
      category: "rate_limit",
      retryable: true,
      rotateCredential: true,
      reduceContext: false,
      status,
      message,
    };
  }
  // Overloaded (provider-specific 529 / "overloaded")
  if (status === 529 || /overloaded/.test(text)) {
    return {
      category: "overloaded",
      retryable: true,
      rotateCredential: false,
      reduceContext: false,
      status,
      message,
    };
  }
  // Context too long
  if (
    /context.*(length|too long|exceed)|maximum.*context|token.*limit|prompt.*too long|context_window_exceeded/.test(
      text
    )
  ) {
    return {
      category: "context_too_long",
      retryable: false,
      rotateCredential: false,
      reduceContext: true,
      status,
      message,
    };
  }
  // Timeout
  if (status === 408 || /timeout|timed? ?out|aborted/.test(text)) {
    return {
      category: "timeout",
      retryable: true,
      rotateCredential: false,
      reduceContext: false,
      status,
      message,
    };
  }
  // Network
  if (/econnreset|enotfound|econnrefused|fetch failed|network|socket hang up|epipe/.test(text)) {
    return {
      category: "network",
      retryable: true,
      rotateCredential: false,
      reduceContext: false,
      status,
      message,
    };
  }
  // Bad request (400-level, non-auth)
  if (status !== undefined && status >= 400 && status < 500) {
    return {
      category: "bad_request",
      retryable: false,
      rotateCredential: false,
      reduceContext: false,
      status,
      message,
    };
  }
  // Server error (5xx, non-specific)
  if (status !== undefined && status >= 500) {
    return {
      category: "server_error",
      retryable: true,
      rotateCredential: false,
      reduceContext: false,
      status,
      message,
    };
  }
  // Fallback: treat transient statuses as retryable.
  if (status !== undefined && isTransientStatus(status)) {
    return {
      category: "server_error",
      retryable: true,
      rotateCredential: false,
      reduceContext: false,
      status,
      message,
    };
  }
  return {
    category: "unknown",
    retryable: false,
    rotateCredential: false,
    reduceContext: false,
    status,
    message,
  };
}

/** A short, user-facing message derived from a classified error. */
export function summarizeClassifiedError(error: ClassifiedApiError): string {
  switch (error.category) {
    case "auth":
      return "Authentication failed — check your API key or credential for this provider.";
    case "billing":
      return "This account is out of quota or has a billing issue.";
    case "rate_limit":
      return "Rate limit reached — backing off and retrying.";
    case "overloaded":
      return "The provider is temporarily overloaded — retrying.";
    case "context_too_long":
      return "The request exceeded the model's context window.";
    case "timeout":
      return "The request timed out — retrying.";
    case "network":
      return "A network error occurred — retrying.";
    case "server_error":
      return "The provider returned a server error — retrying.";
    case "bad_request":
      return "The provider rejected the request as invalid.";
    default:
      return error.message;
  }
}
