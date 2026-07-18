import {
  type OpenAIChoice,
  type OpenAICodexTurnResult,
  type OpenAIUsage,
  parseToolArguments,
} from "./agent-internals";
import { redactSecretText } from "./redaction";

export function parseOpenAICodexJsonTurnResponse(
  json: Record<string, unknown>
): OpenAICodexTurnResult {
  const choice = (json.choices as OpenAIChoice[] | undefined)?.[0];
  if (!choice?.message) {
    const payload = redactSecretText(JSON.stringify(json)).slice(0, 500);
    throw new Error(`Unexpected JSON response shape: ${payload}`);
  }
  return {
    content: choice.message.content || "",
    toolCalls: (choice.message.tool_calls || []).map((toolCall) => ({
      id: toolCall.id,
      callId: toolCall.id.split("|")[0] || toolCall.id,
      itemId: toolCall.id.split("|")[1] || undefined,
      name: toolCall.function?.name || "",
      args: parseToolArguments(toolCall.function?.arguments),
    })),
    usage: json.usage
      ? {
          inputTokens: Number((json.usage as OpenAIUsage).prompt_tokens || 0),
          outputTokens: Number((json.usage as OpenAIUsage).completion_tokens || 0),
          cachedInputTokens: Number(
            (json.usage as OpenAIUsage).prompt_tokens_details?.cached_tokens || 0
          ),
        }
      : undefined,
  };
}
