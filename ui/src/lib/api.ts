import type {
  Agent,
  Provider,
  Channel,
  Memory,
  Task,
  Skill,
  ChatMessage,
  ChatSession,
  ApiResponse,
  DashboardStats,
} from "@/types";
import { apiFetch } from "@/lib/auth";

const API_BASE = "/api";

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${endpoint}`;
  const response = await apiFetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error };
  }

  const data = await response.json();
  return { success: true, data };
}

// Agents API
export const agentsApi = {
  list: () => fetchApi<Agent[]>("/agents"),
  get: (id: string) => fetchApi<Agent>(`/agents/${id}`),
  create: (agent: Omit<Agent, "id" | "createdAt" | "updatedAt">) =>
    fetchApi<Agent>("/agents", { method: "POST", body: JSON.stringify(agent) }),
  update: (id: string, agent: Partial<Agent>) =>
    fetchApi<Agent>(`/agents/${id}`, { method: "PUT", body: JSON.stringify(agent) }),
  delete: (id: string) => fetchApi<void>(`/agents/${id}`, { method: "DELETE" }),
  chat: (id: string, message: string, sessionId?: string) =>
    fetchApi<{ message: ChatMessage; sessionId: string }>(`/agents/${id}/chat`, {
      method: "POST",
      body: JSON.stringify({ message, sessionId }),
    }),
};

// Providers API
export const providersApi = {
  list: () => fetchApi<Provider[]>("/providers"),
  get: (id: string) => fetchApi<Provider>(`/providers/${id}`),
  create: (provider: Omit<Provider, "id" | "createdAt">) =>
    fetchApi<Provider>("/providers", { method: "POST", body: JSON.stringify(provider) }),
  update: (id: string, provider: Partial<Provider>) =>
    fetchApi<Provider>(`/providers/${id}`, { method: "PUT", body: JSON.stringify(provider) }),
  delete: (id: string) => fetchApi<void>(`/providers/${id}`, { method: "DELETE" }),
  test: (id: string) =>
    fetchApi<{ success: boolean; latency: number }>(`/providers/${id}/test`, { method: "POST" }),
};

// Channels API
export const channelsApi = {
  list: () => fetchApi<Channel[]>("/channels"),
  get: (id: string) => fetchApi<Channel>(`/channels/${id}`),
  create: (channel: Omit<Channel, "id" | "createdAt">) =>
    fetchApi<Channel>("/channels", { method: "POST", body: JSON.stringify(channel) }),
  update: (id: string, channel: Partial<Channel>) =>
    fetchApi<Channel>(`/channels/${id}`, { method: "PUT", body: JSON.stringify(channel) }),
  delete: (id: string) => fetchApi<void>(`/channels/${id}`, { method: "DELETE" }),
  test: (id: string) =>
    fetchApi<{ success: boolean; running?: boolean; error?: string }>(`/channels/${id}/test`, {
      method: "POST",
    }),
  getPairings: (id: string) =>
    fetchApi<{
      pairings: Array<{
        id: string;
        senderId: string;
        code: string;
        platform: string;
        displayName?: string;
        status: string;
        createdAt: string;
        expiresAt: string;
      }>;
      pendingCount: number;
      config?: Record<string, unknown>;
    }>(`/channels/${id}/pairings`),
  verifyPairing: (id: string, code: string) =>
    fetchApi<{ success: boolean; senderId?: string; error?: string }>(
      `/channels/${id}/pairings/verify`,
      {
        method: "POST",
        body: JSON.stringify({ code }),
      }
    ),
  rejectPairing: (id: string, pairingId: string) =>
    fetchApi<{ success: boolean }>(`/channels/${id}/pairings/${pairingId}/reject`, {
      method: "POST",
    }),
  setupTelegram: (botToken: string, webhookUrl: string) =>
    fetchApi<Channel>("/channels/telegram/setup", {
      method: "POST",
      body: JSON.stringify({ botToken, webhookUrl }),
    }),
};

// MCP API
export interface MCPServer {
  id: string;
  name: string;
  command: string;
  args?: string;
  env?: string;
  enabled: boolean;
  status: string;
  toolCount: number;
}

export interface MCPRegistryServer {
  id: string;
  name: string;
  description: string;
  registry: string;
  package: string;
  command: string;
  args?: string;
  envVars?: string[];
  categories?: string[];
  installType?: string;
}

export const mcpApi = {
  list: () => fetchApi<MCPServer[]>("/mcp"),
  popular: () => fetchApi<MCPRegistryServer[]>("/mcp/registry/popular"),
  search: (query: string) =>
    fetchApi<MCPRegistryServer[]>(`/mcp/registry/search?q=${encodeURIComponent(query)}`),
  install: (payload: { id?: string; package?: string }) =>
    fetchApi<{ success: boolean; id?: string; error?: string }>("/mcp/registry/install", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  create: (server: {
    name: string;
    command: string;
    args?: string;
    env?: string;
    enabled?: boolean;
  }) =>
    fetchApi<{
      id: string;
      name: string;
      command: string;
      args?: string;
      env?: string;
      enabled: boolean;
    }>("/mcp", {
      method: "POST",
      body: JSON.stringify(server),
    }),
  start: (id: string) => fetchApi<{ success: boolean; error?: string }>(`/mcp/${id}/start`, { method: "POST" }),
  stop: (id: string) => fetchApi<{ success: boolean; error?: string }>(`/mcp/${id}/stop`, { method: "POST" }),
  delete: (id: string) => fetchApi<{ success: boolean }>(`/mcp/${id}`, { method: "DELETE" }),
};

// Settings / Config API
export const settingsApi = {
  getConfig: () => fetchApi<Record<string, unknown>>("/config"),
  updateConfig: (data: Record<string, unknown>) =>
    fetchApi<{ success: boolean }>("/config", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

// Setup API
export const setupApi = {
  status: () => fetchApi<{ complete: boolean }>("/setup/status"),
  complete: () => fetchApi<{ success: boolean }>("/setup/complete", { method: "POST" }),
};

// Memory API
export const memoryApi = {
  list: (params?: { agentId?: string; userId?: string; search?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.agentId) query.append("agentId", params.agentId);
    if (params?.userId) query.append("userId", params.userId);
    if (params?.search) query.append("search", params.search);
    if (params?.limit) query.append("limit", params.limit.toString());
    return fetchApi<Memory[]>(`/memory?${query.toString()}`);
  },
  createFile: (file: string, content: string) =>
    fetchApi<{ success: boolean; file: string }>("/memory", {
      method: "POST",
      body: JSON.stringify({ file, content }),
    }),
  get: (id: string) => fetchApi<Memory>(`/memory/${id}`),
  create: (memory: Omit<Memory, "id" | "createdAt" | "updatedAt">) =>
    fetchApi<Memory>("/memory", { method: "POST", body: JSON.stringify(memory) }),
  update: (id: string, memory: Partial<Memory>) =>
    fetchApi<Memory>(`/memory/${id}`, { method: "PUT", body: JSON.stringify(memory) }),
  delete: (id: string) => fetchApi<void>(`/memory/${id}`, { method: "DELETE" }),
  search: (query: string, limit?: number) =>
    fetchApi<Memory[] | { results: Memory[] }>(
      `/memory/search?query=${encodeURIComponent(query)}${limit ? `&limit=${limit}` : ""}`
    ),
};

// Tasks API
export const tasksApi = {
  list: () => fetchApi<Task[]>("/tasks"),
  get: (id: string) => fetchApi<Task>(`/tasks/${id}`),
  getRuns: (id: string) =>
    fetchApi<
      Array<{
        id: string;
        task_id: string;
        status: "running" | "completed" | "failed";
        started_at: string;
        completed_at?: string;
        session_id?: string;
        result_preview?: string;
        error?: string;
      }>
    >(`/tasks/${id}/runs`),
  create: (task: Omit<Task, "id" | "createdAt">) =>
    fetchApi<Task>("/tasks", { method: "POST", body: JSON.stringify(task) }),
  update: (id: string, task: Partial<Task>) =>
    fetchApi<Task>(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(task) }),
  delete: (id: string) => fetchApi<void>(`/tasks/${id}`, { method: "DELETE" }),
  run: (id: string) => fetchApi<void>(`/tasks/${id}/run`, { method: "POST" }),
};

// Skills API
export const skillsApi = {
  list: () => fetchApi<Skill[]>("/skills"),
  get: (id: string) => fetchApi<Skill>(`/skills/${id}`),
  create: (skill: Omit<Skill, "id" | "createdAt">) =>
    fetchApi<Skill>("/skills", { method: "POST", body: JSON.stringify(skill) }),
  update: (id: string, skill: Partial<Skill>) =>
    fetchApi<Skill>(`/skills/${id}`, { method: "PUT", body: JSON.stringify(skill) }),
  delete: (id: string) => fetchApi<void>(`/skills/${id}`, { method: "DELETE" }),
  test: (id: string, params: Record<string, unknown>) =>
    fetchApi<unknown>(`/skills/${id}/execute`, { method: "POST", body: JSON.stringify(params) }),
};

// Chat API
export const chatApi = {
  send: (message: string, agentId?: string, sessionId?: string) =>
    fetchApi<{ message: ChatMessage; sessionId: string }>("/chat", {
      method: "POST",
      body: JSON.stringify({ message, agentId, sessionId }),
    }),
  getSessions: () =>
    fetchApi<
      {
        id: string;
        agent_id: string;
        created_at: string;
        updated_at: string;
        message_count?: number;
        last_message?: { role: string; content: string };
      }[]
    >("/sessions"),
  getSession: (id: string) =>
    fetchApi<{
      id: string;
      agent_id: string;
      created_at: string;
      updated_at: string;
      messagesList: ChatMessage[];
    }>("/sessions/" + id),
  deleteSession: (id: string) => fetchApi<void>("/sessions/" + id, { method: "DELETE" }),
};

// Dashboard API
export const dashboardApi = {
  getStats: () => fetchApi<DashboardStats>("/dashboard/stats"),
};

// Logs API
export const logsApi = {
  getSystem: () =>
    fetchApi<{ id: string; level: string; source: string; message: string; created_at: string }[]>(
      "/logs/system"
    ),
  search: (query: string) =>
    fetchApi<{
      system: { id: string; level: string; source: string; message: string; created_at: string }[];
      sessionMessages: {
        id: string;
        session_id: string;
        role: string;
        content: string;
        created_at: string;
      }[];
      agent: { id: string; agent_id: string; action: string; created_at: string }[];
      channel: { id: string; channel_type: string; content: string; created_at: string }[];
    }>("/logs/search?q=" + encodeURIComponent(query)),
  getActivity: (minutes?: number) =>
    fetchApi<{
      system: { id: string; level: string; source: string; message: string; created_at: string }[];
      messages: {
        id: string;
        session_id: string;
        role: string;
        content: string;
        created_at: string;
      }[];
      agent: { id: string; agent_id: string; action: string; created_at: string }[];
      channel: { id: string; channel_type: string; content: string; created_at: string }[];
    }>("/logs/activity?minutes=" + (minutes || 60)),
  getStats: (hours?: number) =>
    fetchApi<{
      counts: { system: number; messages: number; agent: number; channel: number };
      hours: number;
    }>("/logs/stats?hours=" + (hours || 24)),
};

// Sessions API
export const sessionsApi = {
  list: () =>
    fetchApi<
      {
        id: string;
        agent_id: string;
        created_at: string;
        updated_at: string;
        message_count?: number;
        last_message?: { role: string; content: string };
      }[]
    >("/sessions"),
  get: (id: string) =>
    fetchApi<{
      id: string;
      agent_id: string;
      messages?: string;
      created_at: string;
      updated_at: string;
      messagesList: ChatMessage[];
    }>("/sessions/" + id),
  delete: (id: string) => fetchApi<void>("/sessions/" + id, { method: "DELETE" }),
};

// Subagent API
export const subagentApi = {
  spawn: (task: string, options?: { model?: string; timeout?: number; label?: string }) =>
    fetchApi<{ subagentId: string; status: string }>("/subagents/spawn", {
      method: "POST",
      body: JSON.stringify({ task, ...options }),
    }),
  list: () =>
    fetchApi<{ id: string; label: string; status: string; createdAt: string }[]>("/subagents"),
  get: (id: string) =>
    fetchApi<{ id: string; label: string; status: string; result?: unknown }>(`/subagents/${id}`),
  kill: (id: string) => fetchApi<void>(`/subagents/${id}/kill`, { method: "POST" }),
};
