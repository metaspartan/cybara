import { mcpManager } from "../../core/mcp";
import { normalizeRemoteMcpUrl } from "../../core/mcp-http";
import { mcpRegistry } from "../../core/mcp-registry";
import {
  completeMcpOAuth,
  failMcpOAuth,
  finishMcpOAuth,
  getMcpOAuthStatus,
  startMcpOAuth,
} from "../../core/mcp-oauth";
import { validateUrl } from "../security";
import type { RouteHandler } from "./_shared";

interface McpCreateInput {
  name?: unknown;
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  authorization?: unknown;
  enabled?: unknown;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function authorizationEnvironment(value: unknown): string | undefined {
  const token = optionalString(value);
  if (!token) return undefined;
  if (/[\r\n,]/.test(token)) throw new Error("Invalid MCP authorization token");
  return `Authorization=${/^Bearer\s/i.test(token) ? token : `Bearer ${token}`}`;
}

async function validatedRemoteUrl(value: unknown): Promise<string | undefined> {
  if (value === undefined || value === null || value === "") return undefined;
  const url = normalizeRemoteMcpUrl(value);
  const validation = await validateUrl(url);
  if (!validation.valid) throw new Error(validation.error || "Remote MCP URL is not allowed");
  return url;
}

async function validateOAuthUrl(url: string): Promise<void> {
  const validation = await validateUrl(url);
  if (!validation.valid) throw new Error(validation.error || "OAuth endpoint is not allowed");
}

async function createServer(body: unknown) {
  const data = (body || {}) as McpCreateInput;
  const url = await validatedRemoteUrl(data.url);
  const env = url
    ? authorizationEnvironment(data.authorization) || optionalString(data.env)
    : optionalString(data.env);
  const created = mcpManager.create({
    name: optionalString(data.name) || "",
    command: optionalString(data.command),
    args: optionalString(data.args),
    env,
    url,
    enabled: data.enabled !== false,
  });
  return publicServer(created.id);
}

function publicServer(id: string) {
  const server = mcpManager.get(id);
  if (!server) return null;
  const { env, ...safe } = server;
  return { ...safe, hasCredentials: Boolean(env) };
}

export const mcpRoutes: Record<string, RouteHandler> = {
  "GET /api/mcp": () => mcpManager.list(),
  "GET /api/mcp/servers": () => mcpManager.list(),
  "POST /api/mcp/servers": async (body) => await createServer(body),
  "GET /api/mcp/tools": () => mcpManager.getToolDefinitions(),
  "POST /api/mcp": async (body) => await createServer(body),
  "GET /api/mcp/:id": (_body, params) => {
    const server = publicServer(params!.id);
    if (!server) return { error: "MCP server not found" };
    return { ...server, ...mcpManager.getStatus(params!.id) };
  },
  "PUT /api/mcp/:id": async (body, params) => {
    const data = (body || {}) as McpCreateInput;
    const url = await validatedRemoteUrl(data.url);
    const env = data.authorization
      ? authorizationEnvironment(data.authorization)
      : optionalString(data.env);
    return {
      success: mcpManager.update(params!.id, {
        ...(optionalString(data.name) ? { name: optionalString(data.name) } : {}),
        ...(optionalString(data.command) ? { command: optionalString(data.command) } : {}),
        ...(data.args !== undefined ? { args: optionalString(data.args) } : {}),
        ...(data.env !== undefined || data.authorization !== undefined ? { env } : {}),
        ...(url ? { url } : {}),
        ...(typeof data.enabled === "boolean" ? { enabled: data.enabled } : {}),
      }),
    };
  },
  "DELETE /api/mcp/:id": (_body, params) => ({ success: mcpManager.delete(params!.id) }),
  "POST /api/mcp/:id/start": async (_body, params) => await mcpManager.start(params!.id),
  "POST /api/mcp/:id/stop": async (_body, params) => ({
    success: await mcpManager.stop(params!.id),
  }),
  "POST /api/mcp/:id/restart": async (_body, params) => await mcpManager.restart(params!.id),
  "POST /api/mcp/:id/oauth/start": async (_body, params) => {
    const server = mcpManager.get(params!.id);
    if (!server?.url) return { success: false, error: "Remote MCP server not found" };
    return { success: true, ...(await startMcpOAuth(server.id, server.url, validateOAuthUrl)) };
  },
  "GET /api/mcp/oauth/callback": async (_body, params) => {
    if (!params?.state || !params.code)
      return { success: false, error: "OAuth callback is incomplete" };
    try {
      const completed = await finishMcpOAuth(params.state, params.code);
      if (!mcpManager.update(completed.serverId, { env: completed.env })) {
        throw new Error("Failed to save MCP authorization");
      }
      const started = await mcpManager.start(completed.serverId);
      if (!started.success) throw new Error(started.error || "Failed to connect MCP server");
      completeMcpOAuth(params.state);
      return { success: true, serverId: completed.serverId };
    } catch (error) {
      failMcpOAuth(params.state, error);
      throw error;
    }
  },
  "GET /api/mcp/oauth/status": (_body, params) => {
    if (!params?.state) return { status: "not_found" };
    return getMcpOAuthStatus(params.state) || { status: "not_found" };
  },
  "POST /api/mcp/:id/call": async (body, params) => {
    const data = body as { tool: string; args: Record<string, unknown> };
    return await mcpManager.callTool(params!.id, data.tool, data.args);
  },
  "GET /api/mcp/registry/search": async (_body, params) => {
    return await mcpRegistry.search(params?.q || "", params?.registry || undefined);
  },
  "GET /api/mcp/registry/popular": () => mcpRegistry.getPopular(20),
  "GET /api/mcp/registry/categories": () => mcpRegistry.getCategories(),
  "GET /api/mcp/registry/category/:cat": (_body, params) => mcpRegistry.getByCategory(params!.cat),
  "GET /api/mcp/registry/servers/:id": (_body, params) => {
    const server = mcpRegistry.getDetails(params!.id);
    return server || { error: "Server not found in registry" };
  },
  "GET /api/mcp/registry/registries": () => mcpRegistry.getRegistries(),
  "POST /api/mcp/registry/install": async (body) => {
    const data = body as { package?: string; id?: string; trustedAction?: boolean };
    if (data.trustedAction !== true) {
      return {
        success: false,
        error:
          "MCP installs require trustedAction=true because they add executable third-party code.",
      };
    }
    if (data.id) {
      const server = mcpRegistry.getDetails(data.id);
      if (!server) return { success: false, error: "Server not found in registry" };
      const url = server.url ? await validatedRemoteUrl(server.url) : undefined;
      return await mcpRegistry.installServer({ ...server, url });
    }
    if (data.package) return await mcpRegistry.installByPackage(data.package);
    return { success: false, error: "Must provide 'id' or 'package'" };
  },
};
