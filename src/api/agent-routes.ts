import { handleChat } from "../api/chat";
import { agentManager } from "../core/agent";
import { agentImageSupportById } from "../core/agent-image-capabilities";
import { parseAgentConfig } from "../core/agent-internals";
import { listAgentLoopRuns, startAgentLoop } from "../core/agent-loop";
import {
  parseAgentReasoningSetting,
  readAgentReasoningSetting,
  withAgentReasoningSetting,
} from "../core/agent-reasoning";
import { type RouteHandler } from "./routes/_shared";

function agentId(params: Record<string, string> | undefined): string {
  const value = params?.id?.trim();
  if (!value) throw new Error("Validation error: Agent id is required");
  return value;
}

export const agentRoutes: Record<string, RouteHandler> = {
  "GET /api/agents": () => agentManager.list(),
  "GET /api/agents/summary": () => {
    const agents = agentManager.list();
    const imageSupport = agentImageSupportById(agents);
    return agents.map((agent) => {
      const toolProfile = parseAgentConfig(agent.config).tool_profile;
      return {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        model: agent.model,
        provider: agent.provider,
        provider_id: agent.provider_id,
        provider_type: agent.provider_type,
        provider_pool_id: agent.provider_pool_id,
        provider_pool_name: agent.provider_pool_name,
        fallback_provider_id: agent.fallback_provider_id,
        status: agent.status,
        created_at: agent.created_at,
        reasoning_effort: readAgentReasoningSetting(agent.config),
        tool_profile: typeof toolProfile === "string" ? toolProfile : "full",
        supports_images: imageSupport.get(agent.id) ?? false,
      };
    });
  },
  "POST /api/agents": (body) => {
    const data = body as Parameters<typeof agentManager.create>[0];
    return agentManager.create(data);
  },
  "POST /api/agents/default": async () => {
    if (agentManager.hasDefaultAgent()) {
      return { error: "Default agent already exists" };
    }
    const agent = agentManager.createDefault();
    try {
      await agentManager.start(agent.id);
    } catch (error) {
      void error;
    }
    return agentManager.get(agent.id) ?? agent;
  },
  "GET /api/agents/:id": (_body, params) => agentManager.get(agentId(params)),
  "PUT /api/agents/:id": (body, params) =>
    agentManager.update(agentId(params), body as Parameters<typeof agentManager.update>[1]),
  "PUT /api/agents/:id/reasoning": (body, params) => {
    const id = agentId(params);
    const agent = agentManager.get(id);
    if (!agent) return { success: false, error: "Agent not found" };
    const parsed = parseAgentReasoningSetting(
      (body as { reasoning_effort?: unknown } | undefined)?.reasoning_effort
    );
    if (!parsed.valid) return { success: false, error: "Invalid reasoning effort" };
    const updated = agentManager.update(id, {
      config: withAgentReasoningSetting(agent.config, parsed.effort),
    });
    if (!updated) return { success: false, error: "Agent not found" };
    return {
      success: true,
      reasoning_effort: readAgentReasoningSetting(updated.config),
    };
  },
  "POST /api/agents/:id/start": async (_body, params) => ({
    success: await agentManager.start(agentId(params)),
  }),
  "POST /api/agents/:id/stop": async (_body, params) => ({
    success: await agentManager.stop(agentId(params)),
  }),
  "DELETE /api/agents/:id": (_body, params) => ({
    success: agentManager.delete(agentId(params)),
  }),

  "POST /api/agents/:id/message": async (body, params) => {
    const data = body as { message: string };
    if (!data.message) throw new Error("Message content is required");
    const result = await agentManager.message(agentId(params), data.message);
    return result;
  },
  "POST /api/agents/:id/loops": async (body, params) => {
    const data = body as {
      objective?: string;
      label?: string;
      maxIterations?: number;
      maxDurationSeconds?: number;
      maxDuration?: number;
      model?: string;
      useTools?: boolean;
    };

    if (!data.objective || !data.objective.trim()) {
      return { success: false, error: "objective is required" };
    }

    try {
      const run = startAgentLoop({
        agentId: agentId(params),
        objective: data.objective,
        label: data.label,
        maxIterations: data.maxIterations,
        maxDurationSeconds:
          typeof data.maxDurationSeconds === "number" ? data.maxDurationSeconds : data.maxDuration,
        modelOverride: data.model,
        useTools: data.useTools,
      });

      return { success: true, runId: run.id, run };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
  "GET /api/agents/:id/loops": (_body, params) => ({
    runs: listAgentLoopRuns(agentId(params)),
  }),
  "GET /api/agents/:id/history": (_body, params) => {
    return { messages: agentManager.getHistory(agentId(params)) };
  },
  "DELETE /api/agents/:id/history": (_body, params) => {
    return { success: agentManager.clearHistory(agentId(params)) };
  },
  "GET /api/agents/:id/state": (_body, params) => {
    const state = agentManager.getState(agentId(params));
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
    const data = body as {
      message: string;
      sessionId?: string;
      clientPendingId?: string;
      workspaceDir?: string;
      queueMode?: "queue" | "steer";
      useModelRouter?: boolean;
      images?: Array<{ data?: string; url?: string; mimeType?: string }>;
    };
    return await handleChat({
      message: data.message,
      agentId: agentId(params),
      sessionId: data.sessionId,
      clientPendingId: data.clientPendingId,
      workspaceDir: data.workspaceDir,
      queueMode: data.queueMode,
      useModelRouter: data.useModelRouter,
      images: data.images,
    });
  },
};
