import { toolSchemas } from "./registry";
import type { ToolContext, ToolHandler } from "./types";

export {
  checkToolPermissions,
  getDangerousToolNames,
  getToolRequiredPermissions,
  getToolSchemasForLLM,
  isDangerousTool,
  isSelfImprovingSkillsEnabled,
  isToolEnabledForAgent,
  toolSchemas,
} from "./registry";
export {
  checkCircuit,
  checkRateLimit,
  getCircuitState,
  getRateLimitStatus,
  recordCircuitFailure,
  recordCircuitSuccess,
} from "./runtime-guards";
export type { Tool, ToolContext, ToolHandler, ToolOrchestrationState } from "./types";

const handlers = new Map<string, ToolHandler>();
export const toolHandlers = handlers;

function createDeferredToolHandler(name: string): ToolHandler {
  return async (args, context) => {
    if (name === "canvas") {
      const canvas = await import("./handlers/canvas");
      return await canvas.handleCanvas(args, context);
    }
    const runtime = await import("./handlers/index");
    const handler = runtime.getToolHandler(name);
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    return handler(args, context);
  };
}

for (const name of Object.keys(toolSchemas)) {
  handlers.set(name, createDeferredToolHandler(name));
}

export function getToolHandler(name: string): ToolHandler | undefined {
  const existing = handlers.get(name);
  if (existing) return existing;
  if (!toolSchemas[name]) return undefined;
  const handler = createDeferredToolHandler(name);
  handlers.set(name, handler);
  return handler;
}

export async function handleTelegramMedia(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<{ success: boolean; message: string }> {
  const runtime = await import("./handlers/index");
  const result = await runtime.handleTelegramMedia(args, context);
  return result;
}

export type ToolName = keyof typeof toolSchemas;
