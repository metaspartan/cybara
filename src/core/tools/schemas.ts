import type { Tool } from "./types";
import { baseToolSchemas } from "./schemas-base";
import { extendedToolSchemas } from "./schemas-extended";

export const toolSchemas: Record<string, Omit<Tool, "handler">> = {
  ...baseToolSchemas,
  ...extendedToolSchemas,
};
