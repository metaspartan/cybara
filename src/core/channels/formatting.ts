import type { ToolCallInfo } from "./types";

export function escapeMarkdown(text: string): string {
  if (text.length < 50 && !/[[\]()*_`]/.test(text)) {
    return text;
  }
  return text.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export function formatToolCallsForTelegram(toolCalls: ToolCallInfo[]): string {
  if (toolCalls.length === 0) return "";

  let text = "🛠️ *Tool Execution:*\n";

  for (const tc of toolCalls) {
    const statusIcon = tc.status === "completed" ? "✅" : tc.status === "failed" ? "❌" : "⏳";
    const duration = tc.duration ? ` (${tc.duration}ms)` : "";
    text += `\n${statusIcon} \`${tc.name}\`${duration}`;

    if (tc.error) {
      text += `\n   ⚠️ _${escapeMarkdown(tc.error.substring(0, 100))}_`;
    } else if (tc.result) {
      const resultStr = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result);
      const preview = resultStr.length > 80 ? resultStr.substring(0, 80) + "..." : resultStr;
      text += `\n   → \`${escapeMarkdown(preview)}\``;
    }
  }

  return text;
}

export function formatToolCallsForDiscord(toolCalls: ToolCallInfo[]): string {
  if (toolCalls.length === 0) return "";

  let text = "🛠️ **Tool Execution:**\n";

  for (const tc of toolCalls) {
    const statusIcon = tc.status === "completed" ? "✅" : tc.status === "failed" ? "❌" : "⏳";
    const duration = tc.duration ? ` (${tc.duration}ms)` : "";
    text += `\n${statusIcon} \`${tc.name}\`${duration}`;

    if (tc.error) {
      text += `\n   ⚠️ *${tc.error.substring(0, 100)}*`;
    } else if (tc.result) {
      const resultStr = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result);
      const preview = resultStr.length > 100 ? resultStr.substring(0, 100) + "..." : resultStr;
      text += `\n   → \`\`\`${preview}\`\`\``;
    }
  }

  return text;
}

export function formatToolCallsPlain(toolCalls: ToolCallInfo[]): string {
  if (toolCalls.length === 0) return "";

  let text = "🛠️ Tool Execution:\n";

  for (const tc of toolCalls) {
    const statusIcon = tc.status === "completed" ? "✅" : tc.status === "failed" ? "❌" : "⏳";
    const duration = tc.duration ? ` (${tc.duration}ms)` : "";
    text += `\n${statusIcon} ${tc.name}${duration}`;

    if (tc.error) {
      text += `\n   ⚠️ Error: ${tc.error.substring(0, 100)}`;
    } else if (tc.result) {
      const resultStr = typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result);
      const preview = resultStr.length > 100 ? resultStr.substring(0, 100) + "..." : resultStr;
      text += `\n   → ${preview}`;
    }
  }

  return text;
}
