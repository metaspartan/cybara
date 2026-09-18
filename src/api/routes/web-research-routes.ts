import { mcpManager } from "../../core/mcp";
import {
  getWebResearchSettingsStatus,
  updateWebResearchSettings,
  type WebResearchSettingsUpdate,
} from "../../core/web-research-settings";
import type { RouteHandler } from "./_shared";

function mcpServerOptions() {
  const toolsByServer = new Map<string, string[]>();
  for (const tool of mcpManager.getAllTools()) {
    toolsByServer.set(tool.serverId, [...(toolsByServer.get(tool.serverId) ?? []), tool.name]);
  }
  return mcpManager.list().map((server) => ({
    id: server.id,
    name: server.name,
    running: server.status === "running",
    tools: (toolsByServer.get(server.id) ?? []).sort(),
  }));
}

function settingsResponse(status: ReturnType<typeof getWebResearchSettingsStatus>) {
  return { ...status, mcpServers: mcpServerOptions() };
}

export const webResearchRoutes: Record<string, RouteHandler> = {
  "GET /api/web-research/settings": () => settingsResponse(getWebResearchSettingsStatus()),
  "PUT /api/web-research/settings": (body) =>
    settingsResponse(updateWebResearchSettings((body || {}) as WebResearchSettingsUpdate)),
};
