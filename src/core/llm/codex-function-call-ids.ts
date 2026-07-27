export interface CodexFunctionCallIds {
  callId: string;
  itemId?: string;
}

export function isCodexFunctionCallItemId(value: string | undefined): boolean {
  return typeof value === "string" && value.startsWith("fc_") && value.length > 3;
}

export function parseCodexFunctionCallId(value: string): CodexFunctionCallIds {
  const separatorIndex = value.indexOf("|");
  if (separatorIndex < 0) return { callId: value };

  const callId = value.slice(0, separatorIndex) || value;
  const itemId = value.slice(separatorIndex + 1);
  return isCodexFunctionCallItemId(itemId) ? { callId, itemId } : { callId };
}

export function serializeCodexFunctionCallId(callId: string, itemId?: string): string {
  return isCodexFunctionCallItemId(itemId) ? `${callId}|${itemId}` : callId;
}
