export const INTERRUPTED_RESPONSE =
  "Response interrupted before completion. Send the message again to retry.";

const INTERRUPTION_CATEGORY_REASONS: Record<string, string> = {
  rate_limit: "the provider kept rate-limiting the request",
  auth: "provider authentication failed",
  timeout: "the provider did not respond in time",
  overloaded: "the provider was overloaded",
  connection: "the provider connection dropped",
  server_error: "the provider returned a server error",
  context_length: "the request exceeded the model's context window",
};

export function interruptionCategoryReason(category: unknown): string | undefined {
  return typeof category === "string" ? INTERRUPTION_CATEGORY_REASONS[category] : undefined;
}

export function interruptedResponseText(reason?: string): string {
  if (!reason?.trim()) return INTERRUPTED_RESPONSE;
  const trimmed = reason.trim().replace(/\s+/g, " ").slice(0, 200);
  return `Response interrupted before completion — ${trimmed}. Send the message again to retry.`;
}
