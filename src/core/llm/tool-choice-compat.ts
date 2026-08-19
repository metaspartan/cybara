export function shouldRetryByRemovingToolChoice(
  status: number,
  errorText: string,
  requestBody: Record<string, unknown>
): boolean {
  if (status !== 400 && status !== 500) return false;
  if (requestBody.tool_choice === undefined) return false;
  const normalized = errorText.toLowerCase();
  const mentionsToolChoice = normalized.includes("tool_choice");
  const mentionsThinkingMode = normalized.includes("thinking") || normalized.includes("reasoning");
  const mentionsRejection =
    normalized.includes("does not support") ||
    normalized.includes("not supported") ||
    normalized.includes("incompatible") ||
    normalized.includes("unsupported") ||
    normalized.includes("cannot be used") ||
    normalized.includes("not allowed");
  return mentionsToolChoice && mentionsThinkingMode && mentionsRejection;
}

export function toNoToolChoiceRequestBody(
  requestBody: Record<string, unknown>
): Record<string, unknown> {
  const nextBody: Record<string, unknown> = { ...requestBody };
  delete nextBody.tool_choice;
  return nextBody;
}
