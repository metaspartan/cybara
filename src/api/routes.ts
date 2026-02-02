import { config } from "../core/config";
import db, { tables } from "../core/database";
import { agentManager, builtinTools } from "../core/agent";
import { providerManager, providers } from "../core/providers";
import { channelManager, channels, processTelegramWebhook, securityManager } from "../core/channels";
import { taskScheduler } from "../core/scheduler";
import { mcpManager } from "../core/mcp";
import { mcpRegistry } from "../core/mcp-registry";
import { getLSPManager, initLSPManager } from "../core/lsp";
import { getSkills, getSkill, getSkillCategories, executeSkill, loadAllSkills, createEligibilityContext, getSkillsStatusReport, registryManager, clearSkillsCache } from "../core/skills/index";
import {
  handleChat,
  getSession,
  getSessionMessages,
  listSessions,
  deleteSession,
  getChatRateLimitStatus,
} from "../api/chat";
import { getToolSchemasForLLM, getRateLimitStatus, getCircuitState } from "../core/tools/index";
import { executeTool, hasTool } from "../core/tools/handlers/index";
import {
  handleMemoryList,
  handleMemorySearch,
  handleMemoryDelete,
  handleMemoryEdit,
} from "../api/memory/memory-api";
import {
  searchAllLogs,
  getRecentActivity,
  getSessionMessages as getLogSessionMessages,
  getAgentLogs,
} from "../core/logging";
import { buildSystemPrompt } from "../core/system-prompt";
import * as pwManager from "../core/browser/pw-manager";
import { homedir } from "os";
import { securityCheck, validateMessageSize } from "./security";
import { createLogger } from "../core/logger";

const log = createLogger("API");

// ============================================
// REQUEST/RESPONSE LOGGING
// ============================================

interface RequestLog {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
}

// Database query result interfaces
interface CountResult {
  count: number;
}

// Utility to normalize SQLite timestamps to UTC ISO format
// SQLite CURRENT_TIMESTAMP stores UTC but without 'Z' suffix,
// so JS Date() parses it as local time. This adds the 'Z' suffix.
function normalizeTimestamp(timestamp: string | undefined): string | undefined {
  if (!timestamp) return timestamp;
  // If already has timezone info, return as-is
  if (timestamp.includes('Z') || timestamp.includes('+') || timestamp.includes('-', 10)) {
    return timestamp;
  }
  // SQLite format: "YYYY-MM-DD HH:MM:SS" - convert to ISO with Z
  return timestamp.replace(' ', 'T') + 'Z';
}

interface ValueResult {
  value: number;
}

interface MetricsEntry {
  type: string;
  key: string;
  value: number;
  metadata?: string;
}

interface LogEntry {
  id: string;
  level?: string;
  source?: string;
  message?: string;
  metadata?: string;
  created_at: string;
  logType?: string;
}

interface AgentLogEntry {
  id: string;
  agent_id: string;
  action: string;
  details?: string;
  metadata?: string;
  created_at: string;
}

interface ChannelLogEntry {
  id: string;
  channel_type: string;
  channel_id?: string;
  direction: string;
  sender_id?: string;
  content?: string;
  metadata?: string;
  created_at: string;
}

const requestLogs: RequestLog[] = [];
const MAX_LOGS = 1000;

function logRequest(log: RequestLog): void {
  requestLogs.unshift(log);
  if (requestLogs.length > MAX_LOGS) {
    requestLogs.pop();
  }

  // Console log for production monitoring
  const logLevel = log.status >= 500 ? "error" : log.status >= 400 ? "warn" : "info";
  console[logLevel](
    `[API] ${log.method} ${log.path} ${log.status} ${log.durationMs}ms${log.error ? ` - ${log.error}` : ""}`
  );
}

// ============================================
// CORS HEADERS
// ============================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
};

// ============================================
// ROUTES
// ============================================

type RouteHandler = (body?: unknown, params?: Record<string, string>) => Promise<unknown> | unknown;

const routes: Record<string, RouteHandler> = {
  // ===== HEALTH & STATUS =====
  "GET /api/health": () => {
    const now = new Date();
    return {
      status: "healthy",
      timestamp: now.toISOString(),
      uptime: process.uptime(),
      version: "1.0.0",
      checks: {
        database: checkDatabaseHealth(),
        agents: agentManager.getStats(),
        providers: providerManager.getStats(),
        memory: getMemoryUsage(),
      },
    };
  },

  "GET /api/health/ready": () => ({
    ready: true,
    timestamp: new Date().toISOString(),
  }),

  "GET /api/health/live": () => ({
    live: true,
    timestamp: new Date().toISOString(),
  }),

  "GET /api/metrics": () => ({
    requestCount: requestLogs.length,
    recentRequests: requestLogs.slice(0, 100),
    rateLimits: {
      chat: getChatRateLimitStatus(),
    },
    circuitBreakers: getCircuitBreakersStatus(),
    memory: getMemoryUsage(),
    uptime: process.uptime(),
  }),

  // ===== INFO =====
  "GET /api/info": () => ({
    name: "Cybara",
    version: "1.0.0",
    setupComplete: config.isSetupComplete(),
    stats: {
      agents: agentManager.getStats(),
      providers: providerManager.getStats(),
      channels: channelManager.getStats(),
      tasks: taskScheduler.getStats(),
    },
  }),

  // ===== SETUP =====
  "GET /api/setup/status": () => ({
    complete: config.isSetupComplete(),
    currentStep: config.getSetupStep(),
  }),
  "POST /api/setup/complete": () => {
    config.completeSetup();
    if (!agentManager.hasDefaultAgent()) {
      agentManager.createDefault();
    }
    return { success: true };
  },

  // ===== CONFIG =====
  "GET /api/config": () => config.getAll(),
  "PUT /api/config": (body) => {
    const data = body as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) {
      config.set(key, value);
    }
    return { success: true };
  },

  // ===== AGENTS =====
  "GET /api/agents": () => agentManager.list(),
  "POST /api/agents": (body) => {
    const data = body as Parameters<typeof agentManager.create>[0];
    return agentManager.create(data);
  },
  "POST /api/agents/default": () => {
    if (agentManager.hasDefaultAgent()) {
      return { error: "Default agent already exists" };
    }
    return agentManager.createDefault();
  },
  "GET /api/agents/:id": (_body, params) => agentManager.get(params!.id),
  "PUT /api/agents/:id": (body, params) =>
    agentManager.update(params!.id, body as Parameters<typeof agentManager.update>[1]),
  "POST /api/agents/:id/start": async (_body, params) => ({
    success: await agentManager.start(params!.id),
  }),
  "POST /api/agents/:id/stop": async (_body, params) => ({
    success: await agentManager.stop(params!.id),
  }),
  "DELETE /api/agents/:id": (_body, params) => ({ success: agentManager.delete(params!.id) }),

  // Running agent messaging and history
  "POST /api/agents/:id/message": async (body, params) => {
    const data = body as { message: string };
    if (!data.message) throw new Error("Message content is required");
    const result = await agentManager.message(params!.id, data.message);
    return result;
  },
  "GET /api/agents/:id/history": (_body, params) => {
    return { messages: agentManager.getHistory(params!.id) };
  },
  "DELETE /api/agents/:id/history": (_body, params) => {
    return { success: agentManager.clearHistory(params!.id) };
  },
  "GET /api/agents/:id/state": (_body, params) => {
    const state = agentManager.getState(params!.id);
    if (!state) return { running: false };
    return {
      running: true,
      startedAt: state.startedAt.toISOString(),
      pid: state.pid,
      messageCount: state.messages.length,
      lastActive: state.lastActive.toISOString(),
    };
  },

  "POST /api/agents/:id/chat": async (body, params) => {
    const data = body as { message: string; sessionId?: string };
    return await handleChat({
      message: data.message,
      agentId: params!.id,
      sessionId: data.sessionId,
    });
  },

  // ===== TOOLS =====
  "GET /api/tools/builtin": () => builtinTools,
  "GET /api/tools": () => getToolSchemasForLLM(),
  "GET /api/tools/:name": (_body, params) => {
    const schemas = getToolSchemasForLLM();
    const found = schemas.find((t) => t.name === params!.name);
    return found || { error: "Tool not found" };
  },
  "POST /api/tools/execute": async (body) => {
    const data = body as { name: string; args: Record<string, unknown> };
    if (!data.name) throw new Error("Tool name is required");

    if (!hasTool(data.name)) {
      throw new Error(`Unknown tool: ${data.name}`);
    }

    return await executeTool(data.name, data.args, {
      agentId: "api",
      sessionId: "api",
      channel: "api",
      userId: "user",
    });
  },

  // ===== PROVIDERS =====
  "GET /api/providers": () => providerManager.list(),
  "GET /api/providers/available": () =>
    Object.entries(providers).map(([key, value]) => ({
      id: key,
      name: value.name,
      description: `Use ${value.name} models`,
      baseUrl: value.baseUrl,
      authType: value.authType,
      models: value.models.map((m) => ({
        id: m.id,
        name: m.name,
        context: m.context,
        maxTokens: m.maxTokens,
        reasoning: m.reasoning,
        input: m.input,
      })),
    })),
  "GET /api/providers/:id": (_body, params) => {
    const provider = providerManager.get(params!.id);
    return provider || { error: "Provider not found" };
  },
  "POST /api/providers": (body) => {
    const data = body as {
      provider: string;
      name: string;
      api_key?: string;
      access_token?: string;
      is_default?: boolean;
    };
    return providerManager.create({
      provider: data.provider as Parameters<typeof providerManager.create>[0]["provider"],
      name: data.name,
      api_key: data.api_key,
      access_token: data.access_token,
      is_default: data.is_default,
    });
  },
  "PUT /api/providers/:id": (body, params) => ({
    success: providerManager.update(
      params!.id,
      body as Parameters<typeof providerManager.update>[1]
    ),
  }),
  "DELETE /api/providers/:id": (_body, params) => ({ success: providerManager.delete(params!.id) }),
  "GET /api/providers/:id/models": (_body, params) => providerManager.getModels(params!.id),
  "POST /api/providers/discover/ollama": async () => await providerManager.discoverOllamaModels(),

  // ===== MCP SERVERS =====
  "GET /api/mcp": () => mcpManager.list(),
  "GET /api/mcp/:id": (_body, params) => {
    const server = mcpManager.get(params!.id);
    if (!server) return { error: "MCP server not found" };
    const status = mcpManager.getStatus(params!.id);
    return { ...server, ...status };
  },
  "POST /api/mcp": (body) => mcpManager.create(body as Parameters<typeof mcpManager.create>[0]),
  "PUT /api/mcp/:id": (body, params) => ({
    success: mcpManager.update(params!.id, body as Parameters<typeof mcpManager.update>[1]),
  }),
  "DELETE /api/mcp/:id": (_body, params) => ({ success: mcpManager.delete(params!.id) }),
  "POST /api/mcp/:id/start": async (_body, params) => await mcpManager.start(params!.id),
  "POST /api/mcp/:id/stop": async (_body, params) => ({
    success: await mcpManager.stop(params!.id),
  }),
  "POST /api/mcp/:id/restart": async (_body, params) => await mcpManager.restart(params!.id),
  "GET /api/mcp/tools": () => mcpManager.getToolDefinitions(),
  "POST /api/mcp/:id/call": async (body, params) => {
    const data = body as { tool: string; args: Record<string, unknown> };
    return await mcpManager.callTool(params!.id, data.tool, data.args);
  },

  // ===== MCP REGISTRY =====
  "GET /api/mcp/registry/search": async (_body, params) => {
    const query = params?.q || "";
    const registry = params?.registry || undefined;
    return await mcpRegistry.search(query, registry);
  },
  "GET /api/mcp/registry/popular": () => mcpRegistry.getPopular(20),
  "GET /api/mcp/registry/categories": () => mcpRegistry.getCategories(),
  "GET /api/mcp/registry/category/:cat": (_body, params) =>
    mcpRegistry.getByCategory(params!.cat),
  "GET /api/mcp/registry/servers/:id": (_body, params) => {
    const server = mcpRegistry.getDetails(params!.id);
    if (!server) return { error: "Server not found in registry" };
    return server;
  },
  "GET /api/mcp/registry/registries": () => mcpRegistry.getRegistries(),
  "POST /api/mcp/registry/install": async (body) => {
    const data = body as { package?: string; id?: string };
    if (data.id) {
      const server = mcpRegistry.getDetails(data.id);
      if (!server) return { success: false, error: "Server not found in registry" };
      return await mcpRegistry.installServer(server);
    }
    if (data.package) {
      return await mcpRegistry.installByPackage(data.package);
    }
    return { success: false, error: "Must provide 'id' or 'package'" };
  },

  // ===== LSP (Language Server Protocol) =====
  "GET /api/lsp/status": async () => {
    try {
      const manager = getLSPManager(process.cwd());
      const supported = manager.getSupportedLanguages();
      const availability: Record<string, { available: boolean; bundled: boolean }> = {};

      for (const lang of supported) {
        availability[lang] = {
          available: await manager.isAvailable(lang),
          bundled: manager.isBundled(lang),
        };
      }

      return {
        status: "ok",
        workspace: process.cwd(),
        supported,
        available: availability,
        diagnosticsCount: manager.getAllDiagnostics().size,
      };
    } catch (e) {
      // Manager not initialized, initialize with cwd
      try {
        const manager = initLSPManager(process.cwd());
        const supported = manager.getSupportedLanguages();
        return {
          status: "initialized",
          workspace: process.cwd(),
          supported,
          available: {},
          diagnosticsCount: 0,
        };
      } catch (err) {
        return { status: "error", error: String(err) };
      }
    }
  },
  "GET /api/lsp/languages": async () => {
    try {
      const manager = getLSPManager(process.cwd());
      const supported = manager.getSupportedLanguages();
      const result: Array<{ name: string; available: boolean; bundled: boolean }> = [];

      for (const lang of supported) {
        result.push({
          name: lang,
          available: await manager.isAvailable(lang),
          bundled: manager.isBundled(lang),
        });
      }

      return { languages: result };
    } catch {
      return { languages: [] };
    }
  },
  "GET /api/lsp/diagnostics": () => {
    try {
      const manager = getLSPManager(process.cwd());
      const all = manager.getAllDiagnostics();
      const result: Array<{ file: string; count: number; errors: number; warnings: number }> = [];

      for (const [uri, diags] of all) {
        result.push({
          file: uri.replace("file://", ""),
          count: diags.length,
          errors: diags.filter(d => d.severity === 1).length,
          warnings: diags.filter(d => d.severity === 2).length,
        });
      }

      return { files: result, total: result.reduce((sum, f) => sum + f.count, 0) };
    } catch {
      return { files: [], total: 0 };
    }
  },
  "GET /api/lsp/install-status": async () => {
    try {
      const manager = getLSPManager(process.cwd());
      const status = await manager.getInstallStatus();
      return { status };
    } catch (e) {
      // If not initialized, create manager first
      try {
        const manager = initLSPManager(process.cwd());
        const status = await manager.getInstallStatus();
        return { status };
      } catch (err) {
        return { status: [], error: String(err) };
      }
    }
  },
  "POST /api/lsp/install": async (body) => {
    const { language } = body as { language: string };
    if (!language) {
      return { success: false, error: "Missing 'language' parameter" };
    }
    try {
      const manager = getLSPManager(process.cwd());
      const result = await manager.installLSP(language);
      return result;
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
  "POST /api/lsp/uninstall": async (body) => {
    const { language } = body as { language: string };
    if (!language) {
      return { success: false, error: "Missing 'language' parameter" };
    }
    try {
      const manager = getLSPManager(process.cwd());
      const result = await manager.uninstallLSP(language);
      return result;
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  "GET /api/channels": () => channelManager.list(),
  "GET /api/channels/available": () =>
    Object.entries(channels).map(([key, value]) => ({
      id: key,
      ...value,
      fields: value.fields,
    })),
  "POST /api/channels": (body) => {
    const data = body as { type: string; name: string; config: Record<string, unknown> };
    return channelManager.create(
      data.type as Parameters<typeof channelManager.create>[0],
      data.name,
      data.config
    );
  },
  "PUT /api/channels/:id": (body, params) => ({
    success: channelManager.update(params!.id, body as Parameters<typeof channelManager.update>[1]),
  }),
  "POST /api/channels/:id/toggle": (body, params) => {
    const data = body as { enabled: boolean };
    return { success: channelManager.update(params!.id, { enabled: data.enabled }) };
  },
  "DELETE /api/channels/:id": (_body, params) => ({ success: channelManager.delete(params!.id) }),

  // Channel Security & Pairing
  "GET /api/channels/:id/pairings": (_body, params) => {
    const channelId = params!.id;
    const rawPairings = securityManager.getAllPairings(channelId);
    // Transform to camelCase for UI
    const pairings = rawPairings.map(p => ({
      id: p.id,
      senderId: p.sender_id,
      code: p.code,
      platform: p.platform,
      displayName: p.sender_name,
      status: p.status,
      createdAt: new Date(p.created_at).toISOString(),
      expiresAt: new Date(p.expires_at).toISOString(),
    }));
    return {
      pairings,
      pendingCount: securityManager.getPendingPairings(channelId).length,
      config: securityManager.getConfig(channelId),
    };
  },
  "POST /api/channels/:id/pairings/verify": (body, params) => {
    const channelId = params!.id;
    const { code } = body as { code: string };
    return securityManager.verifyPairing(channelId, code);
  },
  "POST /api/channels/:id/pairings/:pairingId/reject": (_body, params) => {
    const { id, pairingId } = params!;
    return { success: securityManager.rejectPairing(id, pairingId) };
  },
  "GET /api/channels/:id/allowed-senders": (_body, params) => {
    return { senders: securityManager.getAllowedSenders(params!.id) };
  },
  "POST /api/channels/:id/allowed-senders": (body, params) => {
    const { senderId } = body as { senderId: string };
    securityManager.addAllowedSender(params!.id, senderId);
    return { success: true };
  },
  "DELETE /api/channels/:id/allowed-senders/:senderId": (_body, params) => {
    return { success: securityManager.removeAllowedSender(params!.id, params!.senderId) };
  },
  "PUT /api/channels/:id/security": (body, params) => {
    const channelId = params!.id;
    const config = body as { dm_policy?: string; pairing_expiry_minutes?: number; max_pending_pairings?: number };
    securityManager.setConfig(channelId, config as Parameters<typeof securityManager.setConfig>[1]);
    return { success: true, config: securityManager.getConfig(channelId) };
  },

  // ===== TASKS =====
  "GET /api/tasks": () => taskScheduler.list(),
  "POST /api/tasks": (body) =>
    taskScheduler.create(body as Parameters<typeof taskScheduler.create>[0]),
  "POST /api/tasks/:id/start": async (_body, params) => ({
    success: await taskScheduler.start(params!.id),
  }),
  "POST /api/tasks/:id/stop": async (_body, params) => ({
    success: await taskScheduler.stop(params!.id),
  }),
  "POST /api/tasks/:id/trigger": async (_body, params) => ({
    success: await taskScheduler.trigger(params!.id),
  }),
  "DELETE /api/tasks/:id": (_body, params) => ({ success: taskScheduler.delete(params!.id) }),

  // ===== WEBHOOKS =====
  "POST /api/webhooks/telegram/:channelId": async (body, params) => {
    const { channelId } = params!;

    const success = await processTelegramWebhook(channelId, body as Record<string, unknown>);
    return { ok: success };
  },

  // ===== CHAT / CONVERSATIONS =====
  "POST /api/chat": async (body) => {
    const data = body as {
      message: string;
      agentId?: string;
      sessionId?: string;
      stream?: boolean;
      tools?: boolean;
    };
    return await handleChat(data);
  },
  "GET /api/chat/sessions": () => listSessions(),
  "GET /api/chat/sessions/:id": (_body, params) => getSession(params!.id),
  "GET /api/chat/sessions/:id/messages": (_body, params) => getSessionMessages(params!.id),
  "DELETE /api/chat/sessions/:id": (_body, params) => ({ success: deleteSession(params!.id) }),

  // ===== MEMORY MANAGEMENT =====
  "GET /api/memory": async () => {
    return await handleMemoryList();
  },
  "GET /api/memory/search": async (_body, params) => {
    return await handleMemorySearch(params!.query || "");
  },
  "DELETE /api/memory/:file": async (body, params) => {
    const data = body as { index?: number };
    return await handleMemoryDelete(params!.file, data.index);
  },
  "PUT /api/memory/:file": async (body, params) => {
    const data = body as { index: number; content: string };
    return await handleMemoryEdit(params!.file, data.index, data.content);
  },

  // ===== SKILLS =====
  "GET /api/skills": () => getSkills(),
  "GET /api/skills/categories": () => getSkillCategories(),
  "GET /api/skills/status": async () => {
    // Load skills with full eligibility status
    const homeDir = process.env.HOME || homedir();
    const allSkills = await loadAllSkills({ workspaceDir: homeDir });
    const context = createEligibilityContext();
    const statuses = getSkillsStatusReport(allSkills, context);
    return {
      skills: statuses.map(s => ({
        name: s.skill.name,
        description: s.skill.description,
        location: s.skill.location,
        source: s.source,
        eligible: s.eligible,
        disabled: s.disabled,
        blockedByAllowlist: s.blockedByAllowlist,
        requirements: s.requirements,
        missing: s.missing,
        install: s.install,
        metadata: s.metadata,
      })),
      summary: {
        total: statuses.length,
        eligible: statuses.filter(s => s.eligible).length,
        disabled: statuses.filter(s => s.disabled).length,
        blocked: statuses.filter(s => !s.eligible && !s.disabled).length,
      },
    };
  },
  "GET /api/skills/registry/search": async (_body, params) => {
    const query = params?.q || "";
    if (!query) return { skills: [], registries: registryManager.list().map(r => r.name) };
    const results = await registryManager.searchAll(query);
    return { skills: results };
  },
  "GET /api/skills/registry/browse": async () => {
    const results = await registryManager.browseAll();
    return { skills: results, registries: registryManager.list().map(r => r.name) };
  },
  "POST /api/skills/install": async (body) => {
    const { slug, registry } = body as { slug: string; registry?: string };
    if (!slug) throw new Error("Skill slug is required");
    const result = await registryManager.install(slug, { registry });
    if (result.success) {
      clearSkillsCache(); // Invalidate cache so new skill appears in list
    }
    return result;
  },
  "DELETE /api/skills/:name": async (_body, params) => {
    const result = await registryManager.uninstall(params!.name);
    return result;
  },
  "POST /api/skills/update": async () => {
    const results = await registryManager.updateAll();
    return { updates: results };
  },
  "GET /api/skills/:name": (_body, params) => {
    const skill = getSkill(params!.name);
    return skill || { error: "Skill not found" };
  },
  "POST /api/skills/:name/execute": async (body, params) => {
    const args = body as Record<string, unknown>;
    return await executeSkill(params!.name, args);
  },

  // ===== LOGS =====
  "GET /api/logs/system": async () => {
    // Return combined logs from all log tables
    const system = tables.systemLogs.list ? tables.systemLogs.list() : [];
    const agent = tables.agentLogs.list ? tables.agentLogs.list() : [];
    const channel = tables.channelLogs.list ? tables.channelLogs.list() : [];

    // Combine and format all logs
    const combined = [
      ...system.map((l: any) => ({ ...l, created_at: normalizeTimestamp(l.created_at), logType: "system" })),
      ...agent.map((l: any) => ({
        id: l.id,
        level: "info",
        source: "agent",
        message: `Agent ${l.agent_id.slice(0, 8)}... ${l.action}${l.details ? `: ${l.details}` : ""}`,
        metadata: l.metadata,
        created_at: normalizeTimestamp(l.created_at),
        logType: "agent",
      })),
      ...channel.map((l: any) => ({
        id: l.id,
        level: "info",
        source: "channel",
        message: `${l.direction} ${l.channel_type}${l.sender_id ? ` from ${l.sender_id}` : ""}: ${l.content?.substring(0, 100)}${l.content?.length > 100 ? "..." : ""}`,
        metadata: l.metadata,
        created_at: normalizeTimestamp(l.created_at),
        logType: "channel",
      })),
    ].sort((a, b) => new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime());

    return combined;
  },
  "GET /api/logs/search": async (_body, params) => {
    return await searchAllLogs(params!.q || "", parseInt(params!.limit || "100"));
  },
  "GET /api/logs/activity": async (_body, params) => {
    return await getRecentActivity(parseInt(params!.minutes || "60"));
  },
  "GET /api/logs/sessions/:sessionId/messages": async (_body, params) => {
    const getSessionMessages = getLogSessionMessages;
    return await getSessionMessages(params!.sessionId);
  },
  "GET /api/logs/agents/:agentId": async (_body, params) => {
    return await getAgentLogs(params!.agentId);
  },
  "GET /api/logs/stats": async (_body, params) => {
    const hours = parseInt(params!.hours || "24");
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const systemCount = db
      .prepare("SELECT COUNT(*) as count FROM system_logs WHERE created_at > ?")
      .get(since) as CountResult | null;
    const messageCount = db
      .prepare("SELECT COUNT(*) as count FROM session_messages WHERE created_at > ?")
      .get(since) as CountResult | null;
    const agentCount = db
      .prepare("SELECT COUNT(*) as count FROM agent_logs WHERE created_at > ?")
      .get(since) as CountResult | null;
    const channelCount = db
      .prepare("SELECT COUNT(*) as count FROM channel_logs WHERE created_at > ?")
      .get(since) as CountResult | null;

    return {
      counts: {
        system: systemCount?.count || 0,
        messages: messageCount?.count || 0,
        agent: agentCount?.count || 0,
        channel: channelCount?.count || 0,
      },
      hours,
    };
  },

  // ===== SESSIONS =====
  "GET /api/sessions": async () => {
    const sessions = await listSessions();

    const sessionsWithCounts = await Promise.all(
      sessions.map(async (session: any) => {
        const messages = await getSessionMessages(session.id);
        const lastMessage = messages[messages.length - 1];
        // Get the actual last activity timestamp from the last message
        const updatedAt = lastMessage?.timestamp ? lastMessage.timestamp : session.createdAt;
        return {
          id: session.id,
          agent_id: session.agentId,
          created_at: normalizeTimestamp(session.createdAt),
          updated_at: normalizeTimestamp(updatedAt),
          message_count: session.messageCount,
          last_message: lastMessage
            ? {
              role: lastMessage.role,
              content:
                lastMessage.content.slice(0, 100) +
                (lastMessage.content.length > 100 ? "..." : ""),
            }
            : null,
        };
      })
    );
    // Sort by updated_at (last activity) descending so most recent shows first
    return sessionsWithCounts.sort(
      (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    );
  },
  "GET /api/sessions/:sessionId": async (_body, params) => {
    const session = await getSession(params!.sessionId);
    if (!session) return { error: "Session not found" };
    const messages = await getSessionMessages(params!.sessionId);
    return {
      id: session.id,
      agent_id: session.agentId,
      created_at: normalizeTimestamp(session.createdAt),
      updated_at: normalizeTimestamp(session.createdAt),
      messagesList: messages.map((m: any) => ({
        ...m,
        timestamp: normalizeTimestamp(m.timestamp),
      })),
    };
  },
  "DELETE /api/sessions/:sessionId": async (_body, params) => {
    await deleteSession(params!.sessionId);
    return { success: true, message: "Session deleted" };
  },

  // ===== SYSTEM PROMPT & IDENTITY =====
  "GET /api/system-prompt": () => {
    const config = tables.config.get("systemPrompt");
    if (config) {
      try {
        return JSON.parse(config.value);
      } catch {
        return config.value;
      }
    }
    // Return default structure
    return {
      template: "default",
      customPrompt: "",
      defaultBasePrompt: "",
      identity: {
        name: "Cybara",
        emoji: "🧠",
        creature: "AI assistant",
        vibe: "Professional, helpful, and concise",
        theme: "dark",
      },
      features: {
        memoryEnabled: true,
        skillsEnabled: true,
        messagingEnabled: true,
        replyTagsEnabled: true,
      },
    };
  },
  "PUT /api/system-prompt": (body) => {
    const data = body as Record<string, unknown>;
    tables.config.set("systemPrompt", JSON.stringify(data));
    return { success: true, message: "System prompt configuration saved" };
  },
  "GET /api/system-prompt/preview": async () => {
    // Return a preview of what the system prompt would look like

    const homeDir = process.env.HOME || homedir();
    const preview = buildSystemPrompt({
      modelDisplay: "MiniMax-M2.1",
      tools: [
        "read",
        "write",
        "exec",
        "browser",
        "memory_search",
        "memory_get",
        "message",
        "sessions_spawn",
      ],
      workspaceDir: homeDir,
    });
    return { preview };
  },
  "GET /api/identity": () => {
    const config = tables.config.get("identity");
    if (config) {
      try {
        return JSON.parse(config.value);
      } catch {
        return config.value;
      }
    }
    // Return default identity
    return {
      name: "Cybara",
      emoji: "🧠",
      creature: "AI assistant",
      vibe: "Professional, helpful, and concise",
      theme: "dark",
      avatar: "",
    };
  },
  "PUT /api/identity": (body) => {
    const data = body as Record<string, unknown>;
    tables.config.set("identity", JSON.stringify(data));
    return { success: true, message: "Identity configuration saved" };
  },

  // ===== BROWSER AUTOMATION =====
  "GET /api/browser/status": async () => {
    const getStatus = pwManager.getStatus;
    return await getStatus();
  },
  "GET /api/browser/tabs": async () => {
    const getAllPages = pwManager.getAllPages;
    return { tabs: getAllPages() };
  },
  "POST /api/browser/tabs": async () => {
    const createPage = pwManager.createPage;
    const id = await createPage();
    return { success: true, data: { id } };
  },
  "DELETE /api/browser/tabs/:id": async (_body, params) => {
    const closePage = pwManager.closePage;
    const closed = await closePage(params!.id);
    if (!closed) return { error: "Page not found" };
    return { success: true, message: "Page closed" };
  },
  "POST /api/browser/tabs/:id/navigate": async (body, params) => {
    const navigate = pwManager.navigate;
    const { url, waitUntil } = body as {
      url: string;
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
    };
    if (!url) return { error: "URL is required" };
    const result = await navigate(params!.id, url, { waitUntil });
    return { success: true, data: result };
  },
  "GET /api/browser/tabs/:id/snapshot": async (_body, params) => {
    const getSnapshot = pwManager.getSnapshot;
    const result = await getSnapshot(params!.id);
    return { success: true, data: result };
  },
  "GET /api/browser/tabs/:id/screenshot": async (_body, params) => {
    const screenshot = pwManager.screenshot;
    const screenshotBuffer = await screenshot(params!.id, { fullPage: true });
    return {
      success: true,
      data: {
        screenshot: screenshotBuffer.toString("base64"),
        contentType: "image/png",
      },
    };
  },
  "POST /api/browser/tabs/:id/click": async (body, params) => {
    const click = pwManager.click;
    const { selector, button, doubleClick } = body as {
      selector: string;
      button?: "left" | "right" | "middle";
      doubleClick?: boolean;
    };
    if (!selector) return { error: "Selector is required" };
    await click(params!.id, selector, { button, doubleClick });
    return { success: true, message: "Clicked element" };
  },
  "POST /api/browser/tabs/:id/type": async (body, params) => {
    const type = pwManager.type;
    const { selector, text, submit, clear } = body as {
      selector: string;
      text: string;
      submit?: boolean;
      clear?: boolean;
    };
    if (!selector || typeof text !== "string") return { error: "Selector and text are required" };
    await type(params!.id, selector, text, { submit, clear });
    return { success: true, message: "Typed text" };
  },
  "POST /api/browser/close": async () => {
    const closeAll = pwManager.closeAll;
    await closeAll();
    return { success: true, message: "Browser closed" };
  },

  // ===== SYSTEM STATUS (lightweight - for UI polling) =====
  "GET /api/system/status": () => {
    const metrics = tables.metrics;

    // Get last activity timestamp
    const lastActivity = (metrics.getByType("system_status") as MetricsEntry[]).find(
      (s) => s.key === "last_activity"
    );
    const lastActivityTime = lastActivity?.value ?? 0;
    const now = Date.now();
    const isThinking = lastActivityTime > 0 && now - lastActivityTime < 30000; // 30 second window

    // Get agent count from list
    const agentCount = agentManager.list().length;

    return {
      status: isThinking ? "thinking" : "idle",
      lastActivity: lastActivityTime,
      agentCount,
      timestamp: now,
    };
  },

  // ===== METRICS =====
  "GET /api/metrics/overview": () => {
    const metrics = tables.metrics;

    // Get totals for each metric type
    const tokenTotals = {
      total:
        (metrics.getTotal("token_usage", "input") || 0) +
        (metrics.getTotal("token_usage", "output") || 0) +
        (metrics.getTotal("token_usage", "cache") || 0),
      input: metrics.getTotal("token_usage", "input") || 0,
      output: metrics.getTotal("token_usage", "output") || 0,
      cache: metrics.getTotal("token_usage", "cache") || 0,
    };

    const fileStats = {
      filesRead: metrics.getTotal("file_operation", "read") || 0,
      filesWritten: metrics.getTotal("file_operation", "write") || 0,
      filesEdited: metrics.getTotal("file_operation", "edit") || 0,
      filesSearched: metrics.getTotal("file_operation", "search") || 0,
    };

    // Get tool calls by aggregating all tool_call entries
    const toolCallEntries = metrics.getByType("tool_call") || [];
    const totalToolCalls = toolCallEntries.reduce(
      (sum: number, entry: any) => sum + (entry.value || 0),
      0
    );

    const toolStats = {
      totalCalls: totalToolCalls,
    };

    const apiStats = {
      totalCalls:
        (metrics.getTotal("api_call", "success") || 0) +
        (metrics.getTotal("api_call", "error") || 0),
      successfulCalls: metrics.getTotal("api_call", "success") || 0,
      failedCalls: metrics.getTotal("api_call", "error") || 0,
    };

    const agentStats = {
      totalExecutions:
        (metrics.getTotal("agent_execution", "all") || 0) +
        (metrics.getTotal("agent_execution", "message") || 0),
      totalMessages: metrics.getTotal("agent_execution", "message") || 0,
    };

    // Session and context metrics (OpenClaw parity)
    const sessionStats = {
      totalSessions: metrics.getTotal("session_event", "created") || 0,
      memoryFlushes: metrics.getTotal("memory_flush", "success") || 0,
      memoryFlushFailures: metrics.getTotal("memory_flush", "failure") || 0,
      compactions: metrics.getTotal("context_compaction", "tokens") || 0,
    };

    // Get context utilization warnings
    const contextWarnings = metrics.getByType("context_warning") || [];
    const contextStats = {
      warnings: contextWarnings.length,
      criticalWarnings: contextWarnings.filter((w: any) => {
        try {
          const meta = w.metadata ? JSON.parse(w.metadata) : {};
          return meta.level === "critical";
        } catch { return false; }
      }).length,
    };

    return {
      tokenUsage: tokenTotals,
      fileOperations: fileStats,
      toolCalls: toolStats,
      apiCalls: apiStats,
      agentActivity: agentStats,
      sessions: sessionStats,
      contextHealth: contextStats,
    };
  },


  "GET /api/metrics/tokens": () => {
    const metrics = tables.metrics;

    // Get top models by token usage
    const topModels = metrics.getTopKeys("token_usage_by_model");
    const topProviders = metrics.getTopKeys("token_usage_by_provider");
    const recentTokens = metrics.getByType("token_usage");

    // Calculate total tokens from input + output
    const inputTokens = metrics.getTotal("token_usage", "input") || 0;
    const outputTokens = metrics.getTotal("token_usage", "output") || 0;
    const totalTokens = inputTokens + outputTokens;

    return {
      topModels: topModels.map((m: any) => ({
        model: m.key,
        tokens: m.total,
      })),
      topProviders: topProviders.map((p: any) => ({
        provider: p.key,
        tokens: p.total,
      })),
      recentUsage: recentTokens.slice(0, 50).map((t: any) => ({
        timestamp: t.created_at,
        tokens: t.value,
        metadata: t.metadata ? JSON.parse(t.metadata) : null,
      })),
      totalTokens,
      estimatedCost: 0, // Disabled - billing varies too much between providers
    };
  },

  "GET /api/metrics/files": () => {
    const metrics = tables.metrics;

    const topRead = metrics.getTopKeys("file_read");
    const topWritten = metrics.getTopKeys("file_write");
    const topEdited = metrics.getTopKeys("file_edit");
    const recentOperations = metrics.getByType("file_operation");

    return {
      mostRead: topRead.map((f: any) => ({
        path: f.key,
        count: f.total,
      })),
      mostWritten: topWritten.map((f: any) => ({
        path: f.key,
        count: f.total,
      })),
      mostEdited: topEdited.map((f: any) => ({
        path: f.key,
        count: f.total,
      })),
      recentOperations: recentOperations.slice(0, 50).map((op: any) => ({
        timestamp: op.created_at,
        type: op.key,
        value: op.value,
        metadata: op.metadata ? JSON.parse(op.metadata) : null,
      })),
    };
  },

  "GET /api/metrics/tools": () => {
    const metrics = tables.metrics;

    const topTools = metrics.getTopKeys("tool_call");
    const toolErrors = metrics.getTopKeys("tool_error");
    const recentCalls = metrics.getByType("tool_call");

    return {
      mostUsed: topTools.map((t: any) => ({
        tool: t.key,
        calls: t.total,
      })),
      mostErrors: toolErrors.map((t: any) => ({
        tool: t.key,
        errors: t.total,
      })),
      recentCalls: recentCalls.slice(0, 50).map((call: any) => ({
        timestamp: call.created_at,
        tool: call.key,
        duration: call.value,
        metadata: call.metadata ? JSON.parse(call.metadata) : null,
      })),
    };
  },

  "GET /api/metrics/providers": () => {
    const metrics = tables.metrics;

    // Get provider token entries with metadata (for URL)
    const providerTokenEntries = metrics.getByType("token_usage_by_provider") as MetricsEntry[];

    // Build provider map with URLs from token entries
    const providerMap = new Map();

    for (const entry of providerTokenEntries) {
      // Skip aggregate keys
      if (entry.key === "all" || entry.key === "input" || entry.key === "output") continue;

      const metadata = entry.metadata ? JSON.parse(entry.metadata) : null;
      const url = metadata?.url || "unknown";

      providerMap.set(entry.key, {
        provider: entry.key,
        hits: 0,
        tokens: entry.value || 0,
        url,
      });
    }

    // Add API call hits from api_call entries
    const apiCalls = metrics.getByType("api_call") as MetricsEntry[];
    for (const entry of apiCalls) {
      // Skip aggregate keys
      if (entry.key === "all" || entry.key === "success" || entry.key === "error") continue;

      const metadata = entry.metadata ? JSON.parse(entry.metadata) : null;
      const url = metadata?.url || "unknown";

      if (!providerMap.has(entry.key)) {
        providerMap.set(entry.key, {
          provider: entry.key,
          hits: entry.value || 0,
          tokens: 0,
          url,
        });
      } else {
        // Update URL if we have one from metadata
        if (url !== "unknown") {
          providerMap.get(entry.key).url = url;
        }
        providerMap.get(entry.key).hits += entry.value || 0;
      }
    }

    return {
      providers: Array.from(providerMap.values()).map((p: any) => ({
        provider: p.provider,
        url: p.url,
        hits: p.hits,
        tokens: p.tokens,
      })),
    };
  },

  "GET /api/metrics/time-series": () => {
    // Get daily aggregates for the last 30 days
    const days: Array<Record<string, string | number>> = [];
    const today = new Date();

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];

      // First try pre-aggregated metrics_daily table
      let dailyTotals = tables.metrics.getDailyTotals(dateStr) as Array<{
        type: string;
        total: number;
      }>;

      // If empty, fallback to aggregating from raw metrics table
      if (dailyTotals.length === 0) {
        dailyTotals = tables.metrics.getDailyTotalsFromRaw(dateStr);
      }

      const dayData: Record<string, string | number> = { date: dateStr };

      for (const total of dailyTotals) {
        dayData[total.type] = total.total;
      }

      // If still no metric data, count log entries as activity
      const hasMetricData = Object.keys(dayData).some(k => k !== 'date');
      if (!hasMetricData) {
        try {
          // Count system logs for this date
          const systemCount = db.prepare(
            `SELECT COUNT(*) as count FROM system_logs WHERE date(created_at) = ?`
          ).get(dateStr) as { count: number } | undefined;

          // Count channel logs for this date  
          const channelCount = db.prepare(
            `SELECT COUNT(*) as count FROM channel_logs WHERE date(created_at) = ?`
          ).get(dateStr) as { count: number } | undefined;

          // Count session messages for this date
          const messageCount = db.prepare(
            `SELECT COUNT(*) as count FROM session_messages WHERE date(created_at) = ?`
          ).get(dateStr) as { count: number } | undefined;

          const totalActivity =
            (systemCount?.count || 0) +
            (channelCount?.count || 0) +
            (messageCount?.count || 0);

          if (totalActivity > 0) {
            dayData['activity'] = totalActivity;
            dayData['messages'] = messageCount?.count || 0;
            dayData['channel_events'] = channelCount?.count || 0;
          }
        } catch {
          // Tables might not exist, ignore
        }
      }

      days.push(dayData);
    }

    return { days };
  },

  // Get per-model TPS (tokens per second) metrics
  "GET /api/metrics/models": () => {
    // Get TPS data by model from metrics table
    const tpsData = db.prepare(`
      SELECT 
        key as model,
        AVG(value) as avgTps,
        MAX(value) as maxTps,
        MIN(value) as minTps,
        COUNT(*) as callCount,
        json_extract(metadata, '$.provider') as provider
      FROM metrics 
      WHERE type = 'model_tps'
      GROUP BY key
      ORDER BY AVG(value) DESC
    `).all() as Array<{
      model: string;
      avgTps: number;
      maxTps: number;
      minTps: number;
      callCount: number;
      provider: string | null;
    }>;

    // Get latency data
    const latencyData = db.prepare(`
      SELECT 
        key as model,
        AVG(value) as avgLatency,
        json_extract(metadata, '$.provider') as provider
      FROM metrics 
      WHERE type = 'model_latency'
      GROUP BY key
    `).all() as Array<{
      model: string;
      avgLatency: number;
      provider: string | null;
    }>;

    // Get total tokens by model
    const tokenData = db.prepare(`
      SELECT 
        key as model,
        SUM(value) as totalTokens
      FROM metrics 
      WHERE type = 'token_usage_by_model'
      GROUP BY key
    `).all() as Array<{
      model: string;
      totalTokens: number;
    }>;

    // Merge all data
    const latencyMap = new Map(latencyData.map(l => [l.model, l.avgLatency]));
    const tokenMap = new Map(tokenData.map(t => [t.model, t.totalTokens]));

    const models = tpsData.map(t => ({
      model: t.model,
      provider: t.provider || "unknown",
      avgTps: Math.round(t.avgTps),
      maxTps: t.maxTps,
      minTps: t.minTps,
      avgLatencyMs: Math.round(latencyMap.get(t.model) || 0),
      totalTokens: tokenMap.get(t.model) || 0,
      callCount: t.callCount,
    }));

    return { models };
  },

  "POST /api/metrics/track": (body) => {
    const data = body as {
      type: string;
      key: string;
      value: number;
      metadata?: Record<string, unknown>;
    };

    if (!data.type || !data.key || data.value === undefined) {
      throw new Error("type, key, and value are required");
    }

    const id = crypto.randomUUID();
    tables.metrics.add({
      id,
      type: data.type,
      key: data.key,
      value: data.value,
      metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
    });

    return { success: true, id };
  },
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function checkDatabaseHealth(): { status: string; error?: string } {
  try {
    // Simple check - try to list agents
    agentManager.list();
    return { status: "healthy" };
  } catch (error) {
    return { status: "unhealthy", error: (error as Error).message };
  }
}

function getMemoryUsage(): { heapUsed: number; heapTotal: number; external: number; rss: number } {
  const usage = process.memoryUsage();
  return {
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
    external: Math.round(usage.external / 1024 / 1024),
    rss: Math.round(usage.rss / 1024 / 1024),
  };
}

function getCircuitBreakersStatus(): Record<string, { state: string; failureCount?: number }> {
  const breakers: Record<string, { state: string; failureCount?: number }> = {};

  // Get known circuit breaker states
  const providers = providerManager.list();
  for (const provider of providers) {
    const state = getCircuitState(`llm:${provider.id}`);
    if (state) {
      breakers[`llm:${provider.id}`] = {
        state: state.state,
        failureCount: state.failureCount,
      };
    }
  }

  return breakers;
}

// ============================================
// REQUEST HANDLER
// ============================================

export async function handleRequest(req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}): Promise<{
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}> {
  const startTime = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || "localhost:4269"}`);
  const method = req.method || "GET";
  const path = url.pathname;

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return {
      status: 204,
      headers: corsHeaders,
    };
  }

  // Security check - auth, rate limiting
  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    "127.0.0.1";

  const security = securityCheck(method, path, req.headers, clientIp);
  if (!security.passed) {
    const duration = Date.now() - startTime;
    log.warn(`Security check failed: ${security.error}`, { path, ip: clientIp });
    logRequest({
      timestamp: new Date().toISOString(),
      method,
      path,
      status: security.statusCode || 403,
      durationMs: duration,
      error: security.error,
    });
    return {
      status: security.statusCode || 403,
      headers: { "Content-Type": "application/json", ...corsHeaders, ...security.headers },
      body: { error: security.error },
    };
  }

  const { routeKey, params } = findRoute(method, path);

  // Merge URL query params into params
  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }

  if (!routeKey || !routes[routeKey]) {
    const duration = Date.now() - startTime;
    logRequest({
      timestamp: new Date().toISOString(),
      method,
      path,
      status: 404,
      durationMs: duration,
    });
    return {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: { error: "Not found" },
    };
  }

  try {
    const result = await routes[routeKey](req.body, params);
    const duration = Date.now() - startTime;
    logRequest({
      timestamp: new Date().toISOString(),
      method,
      path,
      status: 200,
      durationMs: duration,
    });
    return {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: result,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = (error as Error).message;
    const errorStack = (error as Error).stack;

    // Log full error for debugging
    console.error(`[API Error] ${method} ${path}:`, error);

    // Provide helpful error messages based on error type
    let userMessage = "An unexpected error occurred";
    let errorCode = "INTERNAL_ERROR";

    if (errorMessage.includes("No API credentials")) {
      userMessage = "API credentials not configured. Please add a provider with valid API keys.";
      errorCode = "MISSING_CREDENTIALS";
    } else if (errorMessage.includes("Rate limit")) {
      userMessage = "Rate limit exceeded. Please try again later.";
      errorCode = "RATE_LIMITED";
    } else if (errorMessage.includes("circuit breaker")) {
      userMessage = "Service temporarily unavailable. Please try again shortly.";
      errorCode = "SERVICE_UNAVAILABLE";
    } else if (errorMessage.includes("LLM API error")) {
      userMessage = `AI service error: ${errorMessage}`;
      errorCode = "LLM_ERROR";
    } else if (errorMessage.includes("not found")) {
      userMessage = errorMessage;
      errorCode = "NOT_FOUND";
    } else if (errorMessage.includes("already exists")) {
      userMessage = errorMessage;
      errorCode = "CONFLICT";
    } else if (errorMessage.includes("Validation") || errorMessage.includes("required")) {
      userMessage = errorMessage;
      errorCode = "VALIDATION_ERROR";
    } else {
      // Generic error - show simplified message to user
      userMessage = "An error occurred while processing your request.";
    }

    logRequest({
      timestamp: new Date().toISOString(),
      method,
      path,
      status: 500,
      durationMs: duration,
      error: errorMessage,
    });
    return {
      status: errorMessage.includes("not found") ? 404 : 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: {
        error: userMessage,
        code: errorCode,
        message: process.env.NODE_ENV === "development" ? errorMessage : undefined,
        path,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

function findRoute(
  method: string,
  path: string
): { routeKey: string | null; params: Record<string, string> } {
  const keys = Object.keys(routes);
  const params: Record<string, string> = {};

  for (const key of keys) {
    const [routeMethod, routePath] = key.split(" ");
    if (routeMethod !== method) continue;

    const routeParts = routePath.split("/");
    const actualParts = path.split("/");

    if (routeParts.length !== actualParts.length) continue;

    let match = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(":")) {
        params[routeParts[i].slice(1)] = actualParts[i];
      } else if (routeParts[i] !== actualParts[i]) {
        match = false;
        break;
      }
    }

    if (match) return { routeKey: key, params };
  }

  return { routeKey: null, params: {} };
}
