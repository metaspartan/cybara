import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const hooksPath = fileURLToPath(new URL("../../ui/src/hooks/useApi.ts", import.meta.url));

function readHooksSource(): string {
  return readFileSync(hooksPath, "utf8");
}

describe("UI hooks API wiring", () => {
  test("agents/providers/channels/tasks hooks keep expected route contracts", () => {
    const source = readHooksSource();

    expect(source).toContain("fetchApi<Agent[]>('/agents')");
    expect(source).toContain("fetchApi<Agent>(`/agents/${id}`)");
    expect(source).toContain("fetchApi<{ id: string }>('/agents/default', { method: 'POST' })");

    expect(source).toContain("fetchApi<Provider[]>('/providers')");
    expect(source).toContain("fetchApi<AvailableProvider[]>('/providers/available')");
    expect(source).toContain("fetchApi<{ models: string[] }>('/providers/discover/ollama', { method: 'POST' })");

    expect(source).toContain("fetchApi<Channel[]>('/channels')");
    expect(source).toContain("fetchApi<AvailableChannel[]>('/channels/available')");
    expect(source).toContain("fetchApi<void>(`/channels/${id}/toggle`");

    expect(source).toContain("fetchApi<Task[]>('/tasks')");
    expect(source).toContain("fetchApi<void>(`/tasks/${id}/start`, { method: 'POST' })");
    expect(source).toContain("fetchApi<void>(`/tasks/${id}/stop`, { method: 'POST' })");
    expect(source).toContain("fetchApi<void>(`/tasks/${id}/trigger`, { method: 'POST' })");
  });

  test("skills/memory/sessions hooks keep expected route contracts", () => {
    const source = readHooksSource();

    expect(source).toContain("fetchApi<Skill[]>('/skills')");
    expect(source).toContain("fetchApi<string[]>('/skills/categories')");
    expect(source).toContain("fetchApi<SkillsStatusResponse>('/skills/status')");
    expect(source).toContain("fetchApi<SkillsRegistryResponse>(`/skills/registry/search${queryString}`)");
    expect(source).toContain("fetchApi<SkillsRegistryResponse>(`/skills/registry/browse${queryString}`)");
    expect(source).toContain("fetchApi<{");
    expect(source).toContain("blockedReason?: 'malware' | 'suspicious';");
    expect(source).toContain("}>('/skills/install'");
    expect(source).toContain("fetchApi<{ updates: Array<{ slug: string; updated: boolean; error?: string }> }>('/skills/update', { method: 'POST' })");

    expect(source).toContain("fetchApi<{ files: string[]; memories: Array<{ file: string; entries: MemoryEntry[] }> }>('/memory')");
    expect(source).toContain("fetchApi<{ results: Array<{ file: string; entry: MemoryEntry }> }>(`/memory/search?query=${encodeURIComponent(query)}`)");
    expect(source).toContain("fetchApi<void>(`/memory/${file}`");

    expect(source).toContain("fetchApi<Session[]>('/chat/sessions')");
    expect(source).toContain("fetchApi<void>(`/chat/sessions/${id}`, { method: 'DELETE' })");
  });

  test("system prompt, LSP, and metrics hooks keep expected route contracts", () => {
    const source = readHooksSource();

    expect(source).toContain("fetchApi<SystemPromptConfig>('/system-prompt')");
    expect(source).toContain("fetchApi<SystemPromptPreview>('/system-prompt/preview')");
    expect(source).toContain("fetchApi<IdentityConfig>('/identity')");

    expect(source).toContain("fetchApi<LSPStatus>('/lsp/status')");
    expect(source).toContain("fetchApi<{ status: LSPInstallStatus[] }>('/lsp/install-status')");
    expect(source).toContain("fetchApi<{ success: boolean; path?: string; error?: string }>('/lsp/install'");
    expect(source).toContain("fetchApi<{ success: boolean; error?: string }>('/lsp/uninstall'");

    expect(source).toContain("fetchApi<MetricsOverview>('/metrics/overview')");
    expect(source).toContain("fetchApi<TokenMetrics>('/metrics/tokens')");
    expect(source).toContain("fetchApi<FileMetrics>('/metrics/files')");
    expect(source).toContain("fetchApi<ToolMetrics>('/metrics/tools')");
    expect(source).toContain("fetchApi<TimeSeriesData>('/metrics/time-series')");
    expect(source).toContain("fetchApi<ProviderMetrics>('/metrics/providers')");
    expect(source).toContain("fetchApi<ModelMetrics>('/metrics/models')");
    expect(source).toContain("fetchApi<MetricsInsights>('/metrics/insights')");
    expect(source).toContain("fetchApi<{ success: boolean; id: string }>('/metrics/track'");
  });

  test("subagent and create-skill hooks stay on shared API client helpers", () => {
    const source = readHooksSource();

    expect(source).toContain("import { subagentApi, skillsApi } from '@/lib/api';");
    expect(source).toContain("const response = await subagentApi.list();");
    expect(source).toContain("const response = await subagentApi.spawn(task, { model, timeout, label });");
    expect(source).toContain("const response = await subagentApi.kill(id);");
    expect(source).toContain("const response = await skillsApi.create(skill);");
    expect(source).not.toContain("fetchApi<{ subagentId: string; status: string }>('/subagents/spawn'");
  });
});
