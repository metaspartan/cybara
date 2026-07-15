import type { ChannelAdapter, ChannelType } from "./types";

export type ChannelCapability =
  | "attachments"
  | "editing"
  | "reactions"
  | "threads"
  | "richContent"
  | "webhooks";

export interface ChannelConformanceReport {
  type: ChannelType;
  name: string;
  valid: boolean;
  capabilities: ChannelCapability[];
  issues: string[];
}

function hasMethod(adapter: ChannelAdapter, key: keyof ChannelAdapter): boolean {
  return typeof adapter[key] === "function";
}

export function inspectChannelAdapter(adapter: ChannelAdapter): ChannelConformanceReport {
  const issues: string[] = [];
  const capabilities: ChannelCapability[] = [];
  const requiredMethods: Array<keyof ChannelAdapter> = [
    "start",
    "stop",
    "isRunning",
    "sendMessage",
    "formatResponse",
  ];

  if (!adapter.type) issues.push("Missing adapter type");
  if (!adapter.name.trim()) issues.push("Missing adapter name");
  for (const method of requiredMethods) {
    if (!hasMethod(adapter, method)) issues.push(`Missing ${method}`);
  }

  if (
    hasMethod(adapter, "sendAttachment") ||
    hasMethod(adapter, "sendPhoto") ||
    hasMethod(adapter, "sendDocument") ||
    hasMethod(adapter, "sendVideo") ||
    hasMethod(adapter, "sendAudio")
  ) {
    capabilities.push("attachments");
  }
  if (hasMethod(adapter, "editMessage")) capabilities.push("editing");
  if (hasMethod(adapter, "sendReaction") || hasMethod(adapter, "removeReaction")) {
    capabilities.push("reactions");
    if (!hasMethod(adapter, "sendReaction") || !hasMethod(adapter, "removeReaction")) {
      issues.push("Reaction support must implement send and remove");
    }
  }
  if (hasMethod(adapter, "createThread")) capabilities.push("threads");
  if (hasMethod(adapter, "sendEmbed") || hasMethod(adapter, "sendInlineKeyboard")) {
    capabilities.push("richContent");
  }
  if (hasMethod(adapter, "handleWebhook")) capabilities.push("webhooks");

  try {
    const formatted = adapter.formatResponse(
      "conformance",
      [{ id: "tool-1", name: "read", status: "completed", result: "ok" }],
      "thinking"
    );
    if (typeof formatted !== "string" || !formatted.trim()) {
      issues.push("formatResponse must return non-empty text");
    }
  } catch (error) {
    issues.push(`formatResponse failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    type: adapter.type,
    name: adapter.name,
    valid: issues.length === 0,
    capabilities,
    issues,
  };
}

export function inspectChannelAdapters(adapters: ChannelAdapter[]): ChannelConformanceReport[] {
  return adapters.map(inspectChannelAdapter);
}
