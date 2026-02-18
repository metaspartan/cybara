import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Agent, AgentMessage, Provider, Channel, Task, Skill, Memory, MemoryEntry, AvailableProvider, AvailableChannel, Session, Tool } from '../types';
import { subagentApi, skillsApi } from '@/lib/api';
import { apiFetch } from '@/lib/auth';

const API_BASE = '/api';

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => fetchApi<Agent[]>('/agents'),
  });
}

export function useAgent(id: string | null) {
  return useQuery({
    queryKey: ['agents', id],
    queryFn: () => fetchApi<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Agent>) => fetchApi<Agent>('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Agent> }) =>
      fetchApi<Agent>(`/agents/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agents', id] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useCreateDefaultAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchApi<{ id: string }>('/agents/default', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useStartAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/agents/${id}/start`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useStopAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/agents/${id}/stop`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useAgentMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) =>
      fetchApi<{ response: string }>(`/agents/${id}/message`, {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agents', id, 'history'] });
      queryClient.invalidateQueries({ queryKey: ['agents', id, 'state'] });
    },
  });
}

export function useAgentHistory(id: string | null) {
  return useQuery({
    queryKey: ['agents', id, 'history'],
    queryFn: () => fetchApi<{ messages: AgentMessage[] }>(`/agents/${id}/history`),
    enabled: !!id,
  });
}

export function useClearAgentHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/agents/${id}/history`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agents', id, 'history'] });
    },
  });
}

export function useAgentState(id: string | null) {
  return useQuery({
    queryKey: ['agents', id, 'state'],
    queryFn: () => fetchApi<{ running: boolean; startedAt?: string; pid?: number; messageCount?: number; lastActive?: string }>(`/agents/${id}/state`),
    enabled: !!id,
    refetchInterval: 5000, // Refresh state every 5 seconds
  });
}

export function useProviders() {
  return useQuery({
    queryKey: ['providers'],
    queryFn: () => fetchApi<Provider[]>('/providers'),
  });
}

export function useAvailableProviders() {
  return useQuery({
    queryKey: ['providers', 'available'],
    queryFn: () => fetchApi<AvailableProvider[]>('/providers/available'),
  });
}

export function useCreateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { provider: string; name: string; api_key?: string; access_token?: string; is_default?: boolean }) =>
      fetchApi<Provider>('/providers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  });
}

export function useUpdateProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Provider> }) =>
      fetchApi<Provider>(`/providers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  });
}

export function useDeleteProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/providers/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['providers'] }),
  });
}

export function useDiscoverOllama() {
  return useMutation({
    mutationFn: () => fetchApi<{ models: string[] }>('/providers/discover/ollama', { method: 'POST' }),
  });
}

export function useProviderModels(providerId: string | null | undefined) {
  return useQuery({
    queryKey: ['providers', providerId, 'models'],
    queryFn: () => fetchApi<Array<{ id: string; model_id: string; model_name?: string; context_window?: number }>>(`/providers/${providerId}/models`),
    enabled: !!providerId,
  });
}

export function useChannels() {
  return useQuery({
    queryKey: ['channels'],
    queryFn: () => fetchApi<Channel[]>('/channels'),
  });
}

export function useAvailableChannels() {
  return useQuery({
    queryKey: ['channels', 'available'],
    queryFn: () => fetchApi<AvailableChannel[]>('/channels/available'),
  });
}

export function useCreateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { type: string; name: string; config: Record<string, unknown> }) =>
      fetchApi<Channel>('/channels', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channels'] }),
  });
}

export function useUpdateChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Channel> }) =>
      fetchApi<Channel>(`/channels/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channels'] }),
  });
}

export function useToggleChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      fetchApi<void>(`/channels/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channels'] }),
  });
}

export function useDeleteChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['channels'] }),
  });
}

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () => fetchApi<Task[]>('/tasks'),
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Task>) => fetchApi<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useStartTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/tasks/${id}/start`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useStopTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/tasks/${id}/stop`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useTriggerTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/tasks/${id}/trigger`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useSkills() {
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => fetchApi<Skill[]>('/skills'),
  });
}

export function useSkillCategories() {
  return useQuery({
    queryKey: ['skills', 'categories'],
    queryFn: () => fetchApi<string[]>('/skills/categories'),
  });
}

export function useExecuteSkill() {
  return useMutation({
    mutationFn: ({ name, args }: { name: string; args: Record<string, unknown> }) =>
      fetchApi<unknown>(`/skills/${name}/execute`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
  });
}

export interface SkillStatusInfo {
  name: string;
  description: string;
  location: string;
  source: 'bundled' | 'local' | 'workspace';
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  requirements: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  missing: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  install: Array<{ type: string; command: string }>;
  metadata?: Record<string, unknown>;
}

export interface SkillsStatusResponse {
  skills: SkillStatusInfo[];
  summary: {
    total: number;
    eligible: number;
    disabled: number;
    blocked: number;
  };
}

export function useSkillsStatus() {
  return useQuery({
    queryKey: ['skills', 'status'],
    queryFn: () => fetchApi<SkillsStatusResponse>('/skills/status'),
  });
}

export interface RegistrySkillInfo {
  slug: string;
  name: string;
  description: string;
  author?: string;
  downloads?: number;
  stars?: number;
  tags?: string[];
  registry: string;
}

export function useSkillsRegistrySearch(query: string) {
  return useQuery({
    queryKey: ['skills', 'registry', 'search', query],
    queryFn: () => fetchApi<{ skills: RegistrySkillInfo[]; registries?: string[] }>(`/skills/registry/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
  });
}

export function useSkillsRegistryBrowse() {
  return useQuery({
    queryKey: ['skills', 'registry', 'browse'],
    queryFn: () => fetchApi<{ skills: RegistrySkillInfo[]; registries?: string[] }>('/skills/registry/browse'),
  });
}

export function useInstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, registry }: { slug: string; registry?: string }) =>
      fetchApi<{ success: boolean; path?: string; error?: string }>('/skills/install', {
        method: 'POST',
        body: JSON.stringify({ slug, registry }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });
}

export function useUninstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      fetchApi<{ success: boolean; error?: string }>(`/skills/${name}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });
}

export function useUpdateAllSkills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => fetchApi<{ updates: Array<{ slug: string; updated: boolean; error?: string }> }>('/skills/update', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });
}

export function useMemory() {
  return useQuery({
    queryKey: ['memory'],
    queryFn: async () => {
      const response = await fetchApi<{ files: string[]; memories: Array<{ file: string; entries: MemoryEntry[] }> }>('/memory');
      return response.memories;
    },
  });
}

export function useSearchMemory(query: string) {
  return useQuery({
    queryKey: ['memory', 'search', query],
    queryFn: async () => {
      const response = await fetchApi<{ results: Array<{ file: string; entry: MemoryEntry }> }>(`/memory/search?query=${encodeURIComponent(query)}`);
      return response.results.map(r => r.entry);
    },
    enabled: query.length > 0,
  });
}

export function useDeleteMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, index }: { file: string; index?: number }) =>
      fetchApi<void>(`/memory/${file}`, {
        method: 'DELETE',
        body: index !== undefined ? JSON.stringify({ index }) : undefined,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memory'] }),
  });
}

export function useUpdateMemory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, index, content }: { file: string; index: number; content: string }) =>
      fetchApi<void>(`/memory/${file}`, {
        method: 'PUT',
        body: JSON.stringify({ index, content }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['memory'] }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => fetchApi<Session[]>('/chat/sessions'),
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchApi<void>(`/chat/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

export interface HealthData {
  status: string;
  timestamp: string;
  uptime: number;
  version: string;
  checks: Record<string, unknown>;
}

export interface InfoData {
  name: string;
  version: string;
  setupComplete: boolean;
  stats: {
    agents: { total: number; running?: number; stopped?: number };
    providers: { total: number; withAuth?: number };
    channels: { total: number; enabled?: number };
    tasks: { total: number; pending?: number; running?: number; completed?: number; failed?: number };
  };
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => fetchApi<HealthData>('/health'),
    refetchInterval: 30000,
  });
}

export function useInfo() {
  return useQuery({
    queryKey: ['info'],
    queryFn: () => fetchApi<InfoData>('/info'),
  });
}

export function useTools() {
  return useQuery({
    queryKey: ['tools'],
    queryFn: () => fetchApi<Tool[]>('/tools'),
  });
}

export interface LSPLanguageStatus {
  available: boolean;
  bundled: boolean;
}

export interface LSPStatus {
  status: string;
  workspace: string;
  supported: string[];
  available: Record<string, LSPLanguageStatus>;
  diagnosticsCount: number;
}

export function useLSPStatus() {
  return useQuery({
    queryKey: ['lsp', 'status'],
    queryFn: () => fetchApi<LSPStatus>('/lsp/status'),
  });
}

export interface LSPInstallStatus {
  language: string;
  displayName: string;
  description: string;
  type: 'bundled' | 'binary' | 'pip' | 'go';
  installed: boolean;
  available: boolean;
  path: string | null;
  requiresRuntime?: string;
}

export function useLSPInstallStatus() {
  return useQuery({
    queryKey: ['lsp', 'install-status'],
    queryFn: () => fetchApi<{ status: LSPInstallStatus[] }>('/lsp/install-status'),
  });
}

export function useInstallLSP() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (language: string) =>
      fetchApi<{ success: boolean; path?: string; error?: string }>('/lsp/install', {
        method: 'POST',
        body: JSON.stringify({ language }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lsp'] });
    },
  });
}

export function useUninstallLSP() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (language: string) =>
      fetchApi<{ success: boolean; error?: string }>('/lsp/uninstall', {
        method: 'POST',
        body: JSON.stringify({ language }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lsp'] });
    },
  });
}

export interface Subagent {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  createdAt: string;
  task: string;
  sessionKey: string;
  result?: unknown;
}

export function useSubagents() {
  return useQuery({
    queryKey: ['subagents'],
    queryFn: async () => {
      const response = await subagentApi.list();
      if (response.success && response.data) {
        return response.data as Subagent[];
      }
      throw new Error(response.error || 'Failed to fetch subagents');
    },
    refetchInterval: 5000, // Poll every 5 seconds
  });
}

export function useSpawnSubagent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      task,
      model,
      timeout,
      label
    }: {
      task: string;
      model?: string;
      timeout?: number;
      label?: string;
    }) => {
      const response = await subagentApi.spawn(task, { model, timeout, label });
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || 'Failed to spawn subagent');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subagents'] });
    },
  });
}

export function useKillSubagent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await subagentApi.kill(id);
      if (response.success) {
        return id;
      }
      throw new Error(response.error || 'Failed to kill subagent');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subagents'] });
    },
  });
}

export function useCreateSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (skill: { name: string; category: string; description: string; content: string }) => {
      const response = await skillsApi.create(skill);
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error || "Failed to create skill");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export interface SystemPromptConfig {
  template: string;
  customPrompt: string;
  defaultBasePrompt: string;
  identity: {
    name: string;
    emoji: string;
    creature: string;
    vibe: string;
    theme: string;
  };
  features: {
    memoryEnabled: boolean;
    skillsEnabled: boolean;
    messagingEnabled: boolean;
    replyTagsEnabled: boolean;
  };
}

export interface IdentityConfig {
  name: string;
  emoji: string;
  creature: string;
  vibe: string;
  theme: string;
  avatar: string;
}

export interface SystemPromptPreview {
  preview: string;
}

export function useSystemPrompt() {
  return useQuery({
    queryKey: ['systemPrompt'],
    queryFn: () => fetchApi<SystemPromptConfig>('/system-prompt'),
  });
}

export function useSystemPromptPreview() {
  return useQuery({
    queryKey: ['systemPromptPreview'],
    queryFn: () => fetchApi<SystemPromptPreview>('/system-prompt/preview'),
    staleTime: 1000, // Preview is generated on-the-fly
  });
}

export function useUpdateSystemPrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: Partial<SystemPromptConfig>) =>
      fetchApi<{ success: boolean; message: string }>('/system-prompt', {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['systemPrompt'] }),
  });
}

export function useIdentity() {
  return useQuery({
    queryKey: ['identity'],
    queryFn: () => fetchApi<IdentityConfig>('/identity'),
  });
}

export function useUpdateIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: Partial<IdentityConfig>) =>
      fetchApi<{ success: boolean; message: string }>('/identity', {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['identity'] }),
  });
}

export interface MetricsOverview {
  tokenUsage: {
    total: number;
    input: number;
    output: number;
    cache: number;
  };
  fileOperations: {
    filesRead: number;
    filesWritten: number;
    filesEdited: number;
    filesSearched: number;
  };
  toolCalls: {
    totalCalls: number;
  };
  apiCalls: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
  };
  agentActivity: {
    totalExecutions: number;
    totalMessages: number;
  };
}

export interface TokenMetrics {
  topModels: Array<{ model: string; tokens: number }>;
  topProviders: Array<{ provider: string; tokens: number }>;
  recentUsage: Array<{ timestamp: string; tokens: number; metadata: any }>;
  totalTokens: number;
  estimatedCost: number;
}

export interface FileMetrics {
  mostRead: Array<{ path: string; count: number }>;
  mostWritten: Array<{ path: string; count: number }>;
  mostEdited: Array<{ path: string; count: number }>;
  recentOperations: Array<{ timestamp: string; type: string; value: number; metadata: any }>;
}

export interface ToolMetrics {
  mostUsed: Array<{ tool: string; calls: number }>;
  mostErrors: Array<{ tool: string; errors: number }>;
  recentCalls: Array<{ timestamp: string; tool: string; duration: number; metadata: any }>;
}

export interface ProviderMetrics {
  providers: Array<{
    provider: string;
    url: string;
    hits: number;
    tokens: number;
  }>;
}

export interface TimeSeriesData {
  days: Array<{
    date: string;
    [key: string]: any;
  }>;
}

export function useMetricsOverview() {
  return useQuery({
    queryKey: ['metrics', 'overview'],
    queryFn: () => fetchApi<MetricsOverview>('/metrics/overview'),
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });
}

export function useMetricsTokens() {
  return useQuery({
    queryKey: ['metrics', 'tokens'],
    queryFn: () => fetchApi<TokenMetrics>('/metrics/tokens'),
    refetchInterval: 5000,
  });
}

export function useMetricsFiles() {
  return useQuery({
    queryKey: ['metrics', 'files'],
    queryFn: () => fetchApi<FileMetrics>('/metrics/files'),
    refetchInterval: 5000,
  });
}

export function useMetricsTools() {
  return useQuery({
    queryKey: ['metrics', 'tools'],
    queryFn: () => fetchApi<ToolMetrics>('/metrics/tools'),
    refetchInterval: 5000,
  });
}

export function useMetricsTimeSeries() {
  return useQuery({
    queryKey: ['metrics', 'time-series'],
    queryFn: () => fetchApi<TimeSeriesData>('/metrics/time-series'),
    refetchInterval: 30000, // Time series doesn't change often, refresh every 30s
  });
}

export function useMetricsProviders() {
  return useQuery({
    queryKey: ['metrics', 'providers'],
    queryFn: () => fetchApi<ProviderMetrics>('/metrics/providers'),
    refetchInterval: 5000,
  });
}

export interface ModelMetrics {
  models: Array<{
    model: string;
    provider: string;
    avgTps: number;
    maxTps: number;
    minTps: number;
    avgLatencyMs: number;
    totalTokens: number;
    callCount: number;
  }>;
}

export interface MetricsInsights {
  tokenBreakdown: {
    total: number;
    input: number;
    output: number;
    cache: number;
    inputPct: number;
    outputPct: number;
    cachePct: number;
  };
  tokenTrend24h: {
    current: number;
    previous: number;
    changePct: number;
    direction: "up" | "down" | "flat";
  };
  cacheEfficiency: {
    cacheTokens: number;
    cacheSharePct: number;
  };
  topModel: {
    model: string;
    tokens: number;
    sharePct: number;
  } | null;
  providerEfficiency: Array<{
    provider: string;
    tokens: number;
    calls: number;
    tokensPerCall: number;
    sharePct: number;
  }>;
  modelInsights: Array<{
    model: string;
    provider: string;
    avgTps: number;
    maxTps: number;
    minTps: number;
    avgLatencyMs: number;
    totalTokens: number;
    callCount: number;
    tokenSharePct: number;
  }>;
  toolReliability: {
    totalCalls: number;
    totalErrors: number;
    successRatePct: number;
  };
  toolUsage24h: Array<{
    tool: string;
    calls: number;
  }>;
  contextHealth24h: {
    warnings: number;
    criticalWarnings: number;
  };
}

export function useMetricsModels() {
  return useQuery({
    queryKey: ['metrics', 'models'],
    queryFn: () => fetchApi<ModelMetrics>('/metrics/models'),
    refetchInterval: 5000,
  });
}

export function useMetricsInsights() {
  return useQuery({
    queryKey: ['metrics', 'insights'],
    queryFn: () => fetchApi<MetricsInsights>('/metrics/insights'),
    refetchInterval: 5000,
  });
}

export function useTrackMetric() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { type: string; key: string; value: number; metadata?: Record<string, unknown> }) =>
      fetchApi<{ success: boolean; id: string }>('/metrics/track', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metrics'] });
    },
  });
}
