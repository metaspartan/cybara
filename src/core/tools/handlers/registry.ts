import type { ToolContext } from "../types";

export type RegisteredToolHandler = (
  args: Record<string, unknown>,
  context?: ToolContext
) => Promise<unknown>;

export const registeredToolHandlers: Record<string, RegisteredToolHandler> = {};

export function registerToolHandler(name: string, handler: RegisteredToolHandler): void {
  registeredToolHandlers[name] = handler;
}

export function unregisterToolHandler(name: string): boolean {
  if (!(name in registeredToolHandlers)) return false;
  delete registeredToolHandlers[name];
  return true;
}

export function getRegisteredToolHandler(name: string): RegisteredToolHandler | undefined {
  return registeredToolHandlers[name];
}
