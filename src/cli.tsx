#!/usr/bin/env bun
import React from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import Gradient from "ink-gradient";
import BigText from "ink-big-text";
import Spinner from "ink-spinner";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const API_BASE = process.env.CYBARA_API || "http://localhost:4269";

interface StatusResponse {
    status: string;
    uptime: number;
    checks: Record<string, { status: string; total?: number; running?: number }>;
    timestamp: string;
}

interface MetricsResponse {
    tokenUsage: { total: number; input: number; output: number; cache: number };
    fileOperations: { filesRead: number; filesWritten: number; filesEdited: number };
    toolCalls: { totalCalls: number };
    apiCalls: { totalCalls: number; successfulCalls: number; failedCalls: number };
    agentExecutions: { totalExecutions: number; totalMessages: number };
}

interface TaskItem {
    id: string;
    name: string;
    status: string;
    schedule?: string;
    lastRun?: string;
}

interface SkillItem {
    name: string;
    description: string;
    eligible: boolean;
    source: string;
}

interface AgentItem {
    id: string;
    name: string;
    type: string;
    status: string;
    model?: string;
}

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T | null> {
    try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
            headers: { "Content-Type": "application/json" },
            ...options,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return await res.json() as T;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
            console.error(`ERROR: Cannot connect to Cybara at ${API_BASE}`);
            console.error("Is the server running? Start it with: cybara start");
        }
        return null;
    }
}

async function rawStatus(): Promise<void> {
    const data = await fetchAPI<StatusResponse>("/api/health");
    if (!data) {
        console.error("ERROR: Failed to connect to Cybara server at", API_BASE);
        process.exit(1);
    }

    const formatUptime = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    console.log("CYBARA STATUS");
    console.log("=============");
    console.log(`status: ${data.status}`);
    console.log(`uptime: ${formatUptime(data.uptime)}`);
    console.log(`timestamp: ${data.timestamp}`);
    console.log("");
    console.log("HEALTH CHECKS");
    for (const [name, info] of Object.entries(data.checks || {})) {
        const status = info.status || "ok";
        const extra = info.total !== undefined ? ` (${info.total} total)` : "";
        console.log(`  ${name}: ${status}${extra}`);
    }
}

async function rawMetrics(): Promise<void> {
    const data = await fetchAPI<MetricsResponse>("/api/metrics/overview");
    if (!data) {
        console.error("ERROR: Failed to fetch metrics from", API_BASE);
        process.exit(1);
    }

    console.log("CYBARA METRICS");
    console.log("==============");
    console.log("");
    console.log("TOKEN USAGE");
    console.log(`  total: ${data.tokenUsage?.total || 0}`);
    console.log(`  input: ${data.tokenUsage?.input || 0}`);
    console.log(`  output: ${data.tokenUsage?.output || 0}`);
    console.log(`  cache: ${data.tokenUsage?.cache || 0}`);
    console.log("");
    console.log("FILE OPERATIONS");
    console.log(`  files_read: ${data.fileOperations?.filesRead || 0}`);
    console.log(`  files_written: ${data.fileOperations?.filesWritten || 0}`);
    console.log(`  files_edited: ${data.fileOperations?.filesEdited || 0}`);
    console.log("");
    console.log("TOOL CALLS");
    console.log(`  total: ${data.toolCalls?.totalCalls || 0}`);
    console.log("");
    console.log("API CALLS");
    console.log(`  total: ${data.apiCalls?.totalCalls || 0}`);
    console.log(`  success: ${data.apiCalls?.successfulCalls || 0}`);
    console.log(`  failed: ${data.apiCalls?.failedCalls || 0}`);
}

async function rawAgents(): Promise<void> {
    const data = await fetchAPI<AgentItem[]>("/api/agents");
    if (!data) {
        console.error("ERROR: Failed to fetch agents from", API_BASE);
        process.exit(1);
    }

    const agents = Array.isArray(data) ? data : [];
    console.log("CYBARA AGENTS");
    console.log("=============");
    console.log(`total: ${agents.length}`);
    console.log("");

    if (agents.length === 0) {
        console.log("No agents configured");
        return;
    }

    for (const agent of agents) {
        console.log(`- ${agent.name}`);
        console.log(`  id: ${agent.id}`);
        console.log(`  type: ${agent.type}`);
        console.log(`  status: ${agent.status || "inactive"}`);
        if (agent.model) console.log(`  model: ${agent.model}`);
    }
}

async function rawTasks(): Promise<void> {
    const data = await fetchAPI<TaskItem[]>("/api/tasks");
    if (!data) {
        console.error("ERROR: Failed to fetch tasks from", API_BASE);
        process.exit(1);
    }

    const tasks = Array.isArray(data) ? data : [];
    console.log("CYBARA TASKS");
    console.log("============");
    console.log(`total: ${tasks.length}`);
    console.log("");

    if (tasks.length === 0) {
        console.log("No tasks scheduled");
        return;
    }

    for (const task of tasks) {
        console.log(`- ${task.name}`);
        console.log(`  id: ${task.id}`);
        console.log(`  status: ${task.status}`);
        if (task.schedule) console.log(`  schedule: ${task.schedule}`);
        if (task.lastRun) console.log(`  last_run: ${task.lastRun}`);
    }
}

async function rawSkills(): Promise<void> {
    const data = await fetchAPI<{ skills: SkillItem[] }>("/api/skills/status");
    if (!data) {
        console.error("ERROR: Failed to fetch skills from", API_BASE);
        process.exit(1);
    }

    const skills = data.skills || [];
    const eligible = skills.filter(s => s.eligible).length;

    console.log("CYBARA SKILLS");
    console.log("=============");
    console.log(`total: ${skills.length}`);
    console.log(`eligible: ${eligible}`);
    console.log(`blocked: ${skills.length - eligible}`);
    console.log("");

    if (skills.length === 0) {
        console.log("No skills installed");
        return;
    }

    console.log("ELIGIBLE:");
    for (const skill of skills.filter(s => s.eligible)) {
        console.log(`  - ${skill.name} (${skill.source})`);
    }

    console.log("");
    console.log("BLOCKED:");
    for (const skill of skills.filter(s => !s.eligible)) {
        console.log(`  - ${skill.name} (${skill.source})`);
    }
}


interface MCPRegistryServer {
    id: string;
    name: string;
    description: string;
    registry: string;
    package: string;
    command: string;
    args?: string;
    envVars?: string[];
}

async function rawMcpSearch(query: string): Promise<void> {
    const data = await fetchAPI<MCPRegistryServer[]>(`/api/mcp/registry/search?q=${encodeURIComponent(query)}`);
    if (!data) {
        console.error("ERROR: Failed to search MCP registry from", API_BASE);
        process.exit(1);
    }

    console.log("MCP REGISTRY SEARCH");
    console.log("===================");
    console.log(`query: ${query}`);
    console.log(`results: ${data.length}`);
    console.log("");

    if (data.length === 0) {
        console.log("No servers found");
        return;
    }

    for (const server of data) {
        console.log(`- ${server.name} (${server.registry})`);
        console.log(`  id: ${server.id}`);
        console.log(`  package: ${server.package}`);
        if (server.description) console.log(`  description: ${server.description.slice(0, 80)}...`);
        if (server.envVars?.length) console.log(`  env_required: ${server.envVars.join(", ")}`);
    }
}

async function rawMcpInstall(pkg: string): Promise<void> {
    console.log(`Installing MCP server: ${pkg}...`);

    const data = await fetchAPI<{ success: boolean; id?: string; error?: string }>(
        "/api/mcp/registry/install",
        { method: "POST", body: JSON.stringify({ package: pkg }) }
    );

    if (!data) {
        console.error("ERROR: Failed to install MCP server from", API_BASE);
        process.exit(1);
    }

    if (data.success) {
        console.log(`SUCCESS: Installed ${pkg}`);
        console.log(`  id: ${data.id}`);
        console.log("");
        console.log("Run 'cybara mcp list' to see installed servers");
    } else {
        console.error(`FAILED: ${data.error || "Unknown error"}`);
        process.exit(1);
    }
}

async function rawMcpList(): Promise<void> {
    const data = await fetchAPI<Array<{ id: string; name: string; command: string; status: string; toolCount: number }>>("/api/mcp");
    if (!data) {
        console.error("ERROR: Failed to list MCP servers from", API_BASE);
        process.exit(1);
    }

    console.log("MCP SERVERS");
    console.log("===========");
    console.log(`total: ${data.length}`);
    console.log("");

    if (data.length === 0) {
        console.log("No MCP servers installed");
        console.log("");
        console.log("Use 'cybara mcp search <query>' to find servers");
        return;
    }

    for (const server of data) {
        console.log(`- ${server.name}`);
        console.log(`  id: ${server.id}`);
        console.log(`  command: ${server.command}`);
        console.log(`  status: ${server.status}`);
        console.log(`  tools: ${server.toolCount}`);
    }
}

async function rawMcpPopular(): Promise<void> {
    const data = await fetchAPI<MCPRegistryServer[]>("/api/mcp/registry/popular");
    if (!data) {
        console.error("ERROR: Failed to get popular MCP servers from", API_BASE);
        process.exit(1);
    }

    console.log("POPULAR MCP SERVERS");
    console.log("===================");
    console.log(`total: ${data.length}`);
    console.log("");

    for (const server of data) {
        console.log(`- ${server.name} [${server.registry}]`);
        console.log(`  id: ${server.id}`);
        if (server.description) console.log(`  ${server.description.slice(0, 60)}`);
    }
}


interface PairingInfo {
    id: string;
    senderId: string;
    code: string;
    platform: string;
    displayName?: string;
    status: string;
    createdAt: string;
    expiresAt: string;
}

interface ChannelInfo {
    id: string;
    name: string;
    type: string;
}

async function rawPairList(): Promise<void> {

    const channels = await fetchAPI<ChannelInfo[]>("/api/channels") || [];

    console.log("PENDING PAIRINGS");
    console.log("================");
    console.log("");

    let totalPending = 0;
    for (const channel of channels) {
        const data = await fetchAPI<{ pairings: PairingInfo[]; pendingCount: number }>(`/api/channels/${channel.id}/pairings`);
        if (!data || data.pendingCount === 0) continue;

        totalPending += data.pendingCount;
        console.log(`${channel.name} (${channel.type}):`);
        for (const p of data.pairings.filter((x) => x.status === "pending")) {
            const name = p.displayName || p.senderId;
            console.log(`  - ${name}`);
            console.log(`    code: ${p.code}`);
            console.log(`    platform: ${p.platform}`);
            console.log(`    expires: ${new Date(p.expiresAt).toLocaleString()}`);
        }
        console.log("");
    }

    if (totalPending === 0) {
        console.log("No pending pairings");
    } else {
        console.log(`Total pending: ${totalPending}`);
        console.log("");
        console.log("To approve: cybara pair <CODE>");
        console.log("To reject:  cybara pair reject <CODE>");
    }
}

async function rawPairApprove(code: string): Promise<void> {

    const channels = await fetchAPI<ChannelInfo[]>("/api/channels") || [];

    for (const channel of channels) {
        const result = await fetchAPI<{ success: boolean; senderId?: string; error?: string }>(
            `/api/channels/${channel.id}/pairings/verify`,
            { method: "POST", body: JSON.stringify({ code: code.toUpperCase() }) }
        );

        if (result?.success) {
            console.log(`✓ Pairing approved!`);
            console.log(`  channel: ${channel.name}`);
            console.log(`  sender: ${result.senderId}`);
            console.log("");
            console.log("The user can now message your bot.");
            return;
        }
    }

    console.error(`✗ Pairing code ${code.toUpperCase()} not found or already expired`);
    console.log("");
    console.log("Use 'cybara pair list' to see pending pairings");
    process.exit(1);
}

async function rawPairReject(code: string): Promise<void> {

    const channels = await fetchAPI<ChannelInfo[]>("/api/channels") || [];

    for (const channel of channels) {
        const pairings = await fetchAPI<{ pairings: PairingInfo[] }>(`/api/channels/${channel.id}/pairings`);
        const pairing = pairings?.pairings.find((p) => p.code === code.toUpperCase());

        if (pairing) {
            const result = await fetchAPI<{ success: boolean }>(
                `/api/channels/${channel.id}/pairings/${pairing.id}/reject`,
                { method: "POST" }
            );

            if (result?.success) {
                console.log(`✓ Pairing rejected`);
                console.log(`  code: ${code.toUpperCase()}`);
                console.log(`  sender: ${pairing.senderId}`);
                return;
            }
        }
    }

    console.error(`✗ Pairing code ${code.toUpperCase()} not found`);
    process.exit(1);
}

async function rawPairPolicy(channelName: string, policy: string): Promise<void> {
    const validPolicies = ["pairing", "allowlist", "open", "disabled"];
    if (!validPolicies.includes(policy)) {
        console.error(`Invalid policy: ${policy}`);
        console.log(`Valid policies: ${validPolicies.join(", ")}`);
        process.exit(1);
    }


    const channels = await fetchAPI<ChannelInfo[]>("/api/channels") || [];
    const channel = channels.find((c) => c.name.toLowerCase() === channelName.toLowerCase() || c.id === channelName);

    if (!channel) {
        console.error(`Channel not found: ${channelName}`);
        console.log("Available channels:");
        for (const c of channels) {
            console.log(`  - ${c.name} (${c.type})`);
        }
        process.exit(1);
    }

    const result = await fetchAPI<{ success: boolean; config: { dm_policy: string } }>(
        `/api/channels/${channel.id}/security`,
        { method: "PUT", body: JSON.stringify({ dm_policy: policy }) }
    );

    if (result?.success) {
        console.log(`✓ DM policy updated`);
        console.log(`  channel: ${channel.name}`);
        console.log(`  policy: ${result.config.dm_policy}`);
    } else {
        console.error("Failed to update policy");
        process.exit(1);
    }
}

interface LSPInstallStatus {
    language: string;
    displayName: string;
    description: string;
    type: "bundled" | "binary" | "pip" | "go";
    installed: boolean;
    available: boolean;
    path: string | null;
    requiresRuntime?: string;
}

async function rawLsp(): Promise<void> {

    const data = await fetchAPI<{ status: LSPInstallStatus[] }>("/api/lsp/install-status");
    if (!data) {
        console.error("ERROR: Failed to get LSP status from", API_BASE);
        process.exit(1);
    }

    console.log("LSP STATUS");
    console.log("==========");
    console.log("");
    console.log("LANGUAGE SERVERS");
    console.log("----------------");

    const bundled = data.status.filter(l => l.type === "bundled");
    const installable = data.status.filter(l => l.type !== "bundled");

    console.log("");
    console.log("Bundled (included in binary):");
    for (const lang of bundled) {
        console.log(`  ✓ ${lang.displayName.padEnd(15)} ${lang.description}`);
    }

    console.log("");
    console.log("Installable:");
    for (const lang of installable) {
        const status = lang.installed ? "✓ installed" : lang.available ? "✓ in PATH" : "✗ not installed";
        const statusIcon = lang.installed || lang.available ? "✓" : "✗";
        const runtime = lang.requiresRuntime ? ` (requires ${lang.requiresRuntime})` : "";
        console.log(`  ${statusIcon} ${lang.displayName.padEnd(15)} ${status}${runtime}`);
        if (lang.path) {
            console.log(`      → ${lang.path}`);
        }
    }

    console.log("");
    console.log("Commands:");
    console.log("  cybara lsp list              - Show this status");
    console.log("  cybara lsp install <lang>    - Install language server");
    console.log("  cybara lsp uninstall <lang>  - Uninstall language server");
    console.log("");
    console.log("Available languages: " + data.status.filter(l => l.type !== "bundled").map(l => l.language).join(", "));
}

async function rawLspInstall(language: string): Promise<void> {
    if (!language) {
        console.error("ERROR: Please specify a language to install");
        console.log("Usage: cybara lsp install <language>");
        console.log("");

        const data = await fetchAPI<{ status: { language: string; displayName: string; type: string }[] }>("/api/lsp/install-status");
        if (data) {
            const installable = data.status.filter(l => l.type !== "bundled");
            console.log("Available languages:");
            for (const lang of installable) {
                console.log(`  ${lang.language.padEnd(12)} - ${lang.displayName}`);
            }
        }
        process.exit(1);
    }

    console.log(`Installing ${language} language server...`);

    const response = await fetch(`${API_BASE}/api/lsp/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
    });

    const result = await response.json() as { success: boolean; error?: string; path?: string };

    if (result.success) {
        console.log(`✓ Successfully installed ${language}`);
        if (result.path) {
            console.log(`  Installed to: ${result.path}`);
        }
    } else {
        console.error(`✗ Failed to install ${language}: ${result.error}`);
        process.exit(1);
    }
}

async function rawLspUninstall(language: string): Promise<void> {
    if (!language) {
        console.error("ERROR: Please specify a language to uninstall");
        console.log("Usage: cybara lsp uninstall <language>");
        process.exit(1);
    }

    console.log(`Uninstalling ${language} language server...`);

    const response = await fetch(`${API_BASE}/api/lsp/uninstall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
    });

    const result = await response.json() as { success: boolean; error?: string };

    if (result.success) {
        console.log(`✓ Successfully uninstalled ${language}`);
    } else {
        console.error(`✗ Failed to uninstall ${language}: ${result.error}`);
        process.exit(1);
    }
}


interface ProviderInfo {
    id: string;
    provider: string;
    name: string;
    is_default: boolean;
    config?: Record<string, unknown>;
}

interface AvailableProviderInfo {
    id: string;
    name: string;
    description: string;
    baseUrl: string;
    authType: string;
    models: { id: string; name: string; context: number }[];
}

async function rawProviders(): Promise<void> {
    const data = await fetchAPI<ProviderInfo[]>("/api/providers");
    if (!data) {
        console.error("ERROR: Failed to fetch providers from", API_BASE);
        process.exit(1);
    }

    const provs = Array.isArray(data) ? data : [];

    console.log("CYBARA PROVIDERS");
    console.log("================");
    console.log(`total: ${provs.length}`);
    console.log("");

    if (provs.length === 0) {
        console.log("No providers configured");
        console.log("Run 'cybara provider add <type>' to add one");
        console.log("Run 'cybara provider available' to see available types");
        return;
    }

    for (const prov of provs) {
        const def = prov.is_default ? " [DEFAULT]" : "";
        console.log(`  ${prov.id.slice(0, 8)}  ${prov.name} (${prov.provider})${def}`);
    }
}

async function rawProviderAvailable(): Promise<void> {
    const data = await fetchAPI<AvailableProviderInfo[]>("/api/providers/available");
    if (!data) {
        console.error("ERROR: Failed to fetch available providers from", API_BASE);
        process.exit(1);
    }

    console.log("AVAILABLE PROVIDER TYPES");
    console.log("========================");
    console.log("");

    for (const prov of data) {
        const auth = prov.authType === "none" ? "(no auth)" : `(${prov.authType})`;
        console.log(`  ${prov.id.padEnd(18)} ${prov.name} ${auth}`);
        console.log(`${"".padEnd(20)} ${prov.models.length} models | ${prov.baseUrl}`);
    }
}

async function rawProviderAdd(type: string, name?: string, apiKey?: string, accessToken?: string, isDefault?: boolean): Promise<void> {
    if (!type) {
        console.error("ERROR: Please specify a provider type");
        console.log("Usage: cybara provider add <type> [--name NAME] [--key KEY] [--token TOKEN] [--default]");
        console.log("");
        console.log("Run 'cybara provider available' to see available types");
        process.exit(1);
    }

    const displayName = name || type.charAt(0).toUpperCase() + type.slice(1);

    const body: Record<string, unknown> = {
        provider: type,
        name: displayName,
    };
    if (apiKey) body.api_key = apiKey;
    if (accessToken) body.access_token = accessToken;
    if (isDefault) body.is_default = true;

    try {
        const response = await fetch(`${API_BASE}/api/providers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const result = await response.json() as { id?: string; error?: string };

        if (result.id) {
            console.log(`✓ Added provider: ${displayName} (${type})`);
            console.log(`  ID: ${result.id}`);
        } else {
            console.error(`✗ Failed to add provider: ${result.error || "Unknown error"}`);
            process.exit(1);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
            console.error(`ERROR: Cannot connect to Cybara at ${API_BASE}`);
            console.error("Is the server running? Start it with: cybara start");
        } else {
            console.error(`✗ Failed to add provider: ${msg}`);
        }
        process.exit(1);
    }
}

async function rawProviderUpdate(id: string, name?: string, apiKey?: string, accessToken?: string, isDefault?: boolean): Promise<void> {
    if (!id) {
        console.error("ERROR: Please specify a provider ID");
        console.log("Usage: cybara provider update <id> [--name NAME] [--key KEY] [--token TOKEN] [--default]");
        process.exit(1);
    }

    const body: Record<string, unknown> = {};
    if (name) body.name = name;
    if (apiKey) body.api_key = apiKey;
    if (accessToken) body.access_token = accessToken;
    if (isDefault !== undefined) body.is_default = isDefault;

    try {
        const response = await fetch(`${API_BASE}/api/providers/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const result = await response.json() as { success?: boolean; error?: string };

        if (result.success) {
            console.log(`✓ Updated provider: ${id}`);
        } else {
            console.error(`✗ Failed to update: ${result.error || "Unknown error"}`);
            process.exit(1);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
            console.error(`ERROR: Cannot connect to Cybara at ${API_BASE}`);
            console.error("Is the server running? Start it with: cybara start");
        } else {
            console.error(`✗ Failed to update provider: ${msg}`);
        }
        process.exit(1);
    }
}

async function rawProviderDelete(id: string): Promise<void> {
    if (!id) {
        console.error("ERROR: Please specify a provider ID");
        console.log("Usage: cybara provider delete <id>");
        process.exit(1);
    }

    try {
        const response = await fetch(`${API_BASE}/api/providers/${id}`, {
            method: "DELETE",
        });

        const result = await response.json() as { success?: boolean; error?: string };

        if (result.success) {
            console.log(`✓ Deleted provider: ${id}`);
        } else {
            console.error(`✗ Failed to delete: ${result.error || "Unknown error"}`);
            process.exit(1);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
            console.error(`ERROR: Cannot connect to Cybara at ${API_BASE}`);
            console.error("Is the server running? Start it with: cybara start");
        } else {
            console.error(`✗ Failed to delete provider: ${msg}`);
        }
        process.exit(1);
    }
}

async function rawProviderModels(id: string): Promise<void> {
    if (!id) {
        console.error("ERROR: Please specify a provider ID");
        console.log("Usage: cybara provider models <id>");
        process.exit(1);
    }

    const data = await fetchAPI<{ id: string; name: string; context: number }[]>(`/api/providers/${id}/models`);
    if (!data) {
        console.error("ERROR: Failed to fetch models from", API_BASE);
        process.exit(1);
    }

    const models = Array.isArray(data) ? data : [];

    console.log(`MODELS FOR PROVIDER ${id}`);
    console.log("=".repeat(26 + id.length));
    console.log(`total: ${models.length}`);
    console.log("");

    for (const model of models) {
        const ctx = model.context ? ` (${(model.context / 1000).toFixed(0)}k ctx)` : "";
        console.log(`  ${model.id.padEnd(30)} ${model.name}${ctx}`);
    }
}

async function rawProviderDiscover(): Promise<void> {
    console.log("Discovering Ollama models...");

    try {
        const response = await fetch(`${API_BASE}/api/providers/discover/ollama`, {
            method: "POST",
        });

        const result = await response.json() as { models?: { id: string }[]; error?: string };

        if (result.models) {
            console.log(`✓ Discovered ${result.models.length} Ollama models`);
            for (const model of result.models) {
                console.log(`  - ${model.id}`);
            }
        } else {
            console.error(`✗ Failed to discover: ${result.error || "Unable to reach Ollama"}`);
            process.exit(1);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
            console.error(`ERROR: Cannot connect to Cybara at ${API_BASE}`);
            console.error("Is the server running? Start it with: cybara start");
        } else {
            console.error(`✗ Failed to discover Ollama models: ${msg}`);
        }
        process.exit(1);
    }
}


function parseProviderFlags(args: string[]): { name?: string; key?: string; token?: string; isDefault: boolean } {
    let name: string | undefined;
    let key: string | undefined;
    let token: string | undefined;
    let isDefault = false;

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--name": name = args[++i]; break;
            case "--key": key = args[++i]; break;
            case "--token": token = args[++i]; break;
            case "--default": isDefault = true; break;
        }
    }

    return { name, key, token, isDefault };
}


interface SessionInfo {
    id: string;
    agent_id?: string;
    message_count: number;
    created_at: string;
    updated_at: string;
}

async function rawSessions(): Promise<void> {
    const data = await fetchAPI<SessionInfo[]>("/api/chat/sessions");
    if (!data) {
        console.error("ERROR: Failed to fetch sessions from", API_BASE);
        process.exit(1);
    }

    const sessions = Array.isArray(data) ? data : [];

    console.log("CYBARA SESSIONS");
    console.log("===============");
    console.log(`total: ${sessions.length}`);
    console.log("");

    if (sessions.length === 0) {
        console.log("No active sessions");
        return;
    }

    for (const session of sessions.slice(0, 20)) {
        console.log(`- ${session.id.slice(0, 8)}...`);
        console.log(`  messages: ${session.message_count}`);
        console.log(`  updated: ${session.updated_at}`);
    }

    if (sessions.length > 20) {
        console.log(`\n... and ${sessions.length - 20} more sessions`);
    }
}


interface MemoryEntry {
    id: string;
    content: string;
    similarity?: number;
    createdAt: string;
}

async function rawMemory(query?: string): Promise<void> {
    const endpoint = query
        ? `/api/memory/search?query=${encodeURIComponent(query)}`
        : "/api/memory";

    const data = await fetchAPI<MemoryEntry[] | { results: MemoryEntry[] }>(endpoint);
    if (!data) {
        console.error("ERROR: Failed to fetch memory from", API_BASE);
        process.exit(1);
    }

    const entries = Array.isArray(data) ? data : (data.results || []);

    console.log("CYBARA MEMORY");
    console.log("=============");
    if (query) console.log(`query: "${query}"`);
    console.log(`results: ${entries.length}`);
    console.log("");

    if (entries.length === 0) {
        console.log("No memory entries found");
        return;
    }

    for (const entry of entries) {
        const preview = entry.content.slice(0, 80).replace(/\n/g, " ");
        console.log(`- ${preview}${entry.content.length > 80 ? "..." : ""}`);
        if (entry.similarity) console.log(`  similarity: ${(entry.similarity * 100).toFixed(1)}%`);
    }
}


interface LogEntry {
    timestamp: string;
    level: string;
    module: string;
    message: string;
}

async function rawLogs(count = 20): Promise<void> {
    const data = await fetchAPI<LogEntry[]>("/api/logs/system");
    if (!data) {
        console.error("ERROR: Failed to fetch logs from", API_BASE);
        process.exit(1);
    }

    const logs = (Array.isArray(data) ? data : []).slice(0, count);

    console.log("CYBARA LOGS");
    console.log("===========");
    console.log(`showing: ${logs.length} entries`);
    console.log("");

    if (logs.length === 0) {
        console.log("No logs available");
        return;
    }

    for (const log of logs) {
        const level = log.level.toUpperCase().padEnd(5);
        const module = log.module.padEnd(12);
        const time = new Date(log.timestamp).toLocaleTimeString();
        console.log(`[${time}] ${level} ${module} ${log.message.slice(0, 60)}`);
    }
}


interface SubagentInfo {
    id: string;
    task: string;
    label: string;
    status: string;
    createdAt: string;
}

async function rawSubagents(): Promise<void> {
    const data = await fetchAPI<SubagentInfo[]>("/api/subagents");
    if (!data) {
        console.error("ERROR: Failed to fetch subagents from", API_BASE);
        process.exit(1);
    }

    const subagents = Array.isArray(data) ? data : [];
    const running = subagents.filter(s => s.status === "running").length;

    console.log("CYBARA SUBAGENTS");
    console.log("================");
    console.log(`total: ${subagents.length}`);
    console.log(`running: ${running}`);
    console.log("");

    if (subagents.length === 0) {
        console.log("No subagents");
        return;
    }

    for (const sub of subagents) {
        const status = sub.status === "running" ? "⟳" : sub.status === "completed" ? "✓" : "✗";
        console.log(`${status} ${sub.label.slice(0, 50)}`);
        console.log(`  id: ${sub.id}`);
        console.log(`  status: ${sub.status}`);
    }
}

async function rawSubagentSpawn(task: string): Promise<void> {
    if (!task) {
        console.error("ERROR: Please specify a task");
        console.log("Usage: cybara subagent spawn <task>");
        process.exit(1);
    }

    const response = await fetch(`${API_BASE}/api/subagents/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, label: `Task: ${task.slice(0, 30)}...` }),
    });

    const result = await response.json() as { id?: string; error?: string };

    if (result.id) {
        console.log(`✓ Spawned subagent: ${result.id}`);
    } else {
        console.error(`✗ Failed to spawn: ${result.error}`);
        process.exit(1);
    }
}

async function rawSubagentKill(id: string): Promise<void> {
    if (!id) {
        console.error("ERROR: Please specify a subagent ID");
        console.log("Usage: cybara subagent kill <id>");
        process.exit(1);
    }

    const response = await fetch(`${API_BASE}/api/subagents/${id}/kill`, {
        method: "POST",
    });

    const result = await response.json() as { success?: boolean; error?: string };

    if (result.success) {
        console.log(`✓ Killed subagent: ${id}`);
    } else {
        console.error(`✗ Failed to kill: ${result.error}`);
        process.exit(1);
    }
}


interface BrowserStatus {
    running: boolean;
    currentUrl?: string;
    profile?: string;
}

async function rawBrowser(): Promise<void> {
    const data = await fetchAPI<BrowserStatus>("/api/browser/status");
    if (!data) {
        console.error("ERROR: Failed to fetch browser status from", API_BASE);
        process.exit(1);
    }

    console.log("CYBARA BROWSER");
    console.log("==============");
    console.log(`status: ${data.running ? "running" : "stopped"}`);
    if (data.profile) console.log(`profile: ${data.profile}`);
    if (data.currentUrl) console.log(`url: ${data.currentUrl}`);
}

interface BrowserTab {
    id: string;
    url: string;
    title?: string;
}

async function rawBrowserProfiles(): Promise<void> {
    const data = await fetchAPI<{ tabs: BrowserTab[] }>("/api/browser/tabs");
    if (!data) {
        console.error("ERROR: Failed to fetch browser tabs from", API_BASE);
        process.exit(1);
    }

    const tabs = Array.isArray(data.tabs) ? data.tabs : [];

    console.log("BROWSER TABS");
    console.log("============");
    console.log(`total: ${tabs.length}`);
    console.log("");

    if (tabs.length === 0) {
        console.log("No open tabs");
        return;
    }

    for (const tab of tabs) {
        console.log(`- ${tab.title || tab.url}`);
        console.log(`  id: ${tab.id}`);
        console.log(`  url: ${tab.url}`);
    }
}


interface ChannelStatus {
    id: string;
    type: string;
    name: string;
    enabled: boolean;
    dmPolicy?: string;
}

async function rawChannels(): Promise<void> {
    const data = await fetchAPI<ChannelStatus[]>("/api/channels");
    if (!data) {
        console.error("ERROR: Failed to fetch channels from", API_BASE);
        process.exit(1);
    }

    const chans = Array.isArray(data) ? data : [];
    const enabled = chans.filter(c => c.enabled).length;

    console.log("CYBARA CHANNELS");
    console.log("===============");
    console.log(`total: ${chans.length}`);
    console.log(`enabled: ${enabled}`);
    console.log("");

    if (chans.length === 0) {
        console.log("No channels configured");
        return;
    }

    for (const chan of chans) {
        const status = chan.enabled ? "✓" : "✗";
        console.log(`${status} ${chan.name} (${chan.type})`);
        if (chan.dmPolicy) console.log(`    policy: ${chan.dmPolicy}`);
    }
}

function rawHelp(): void {
    console.log("CYBARA CLI");
    console.log("==========");
    console.log("");
    console.log("Usage: cybara [command]");
    console.log("");
    console.log("Commands:");
    console.log("  (none)      Interactive TUI menu");
    console.log("  status      Show system status");
    console.log("  metrics     Show token usage and metrics");
    console.log("  agents      List configured agents");
    console.log("  provider    Provider management commands");
    console.log("    provider list         List configured providers");
    console.log("    provider available    Show available types");
    console.log("    provider add <type>   Add provider (--name, --key, --token, --default)");
    console.log("    provider update <id>  Update provider");
    console.log("    provider delete <id>  Delete provider");
    console.log("    provider models <id>  List provider models");
    console.log("    provider discover     Discover Ollama models");
    console.log("  tasks       List scheduled tasks");
    console.log("  skills      List installed skills");
    console.log("  sessions    List chat sessions");
    console.log("  memory      Memory commands");
    console.log("    memory         List recent memories");
    console.log("    memory <query> Search memories");
    console.log("  logs        Show recent logs");
    console.log("  subagent    Subagent commands");
    console.log("    subagent list       List subagents");
    console.log("    subagent spawn <t>  Spawn with task");
    console.log("    subagent kill <id>  Kill subagent");
    console.log("  browser     Browser commands");
    console.log("    browser            Show browser status");
    console.log("    browser tabs       List open browser tabs");
    console.log("  channels    List configured channels");
    console.log("  pair        Channel pairing commands");
    console.log("    pair           List pending pairings");
    console.log("    pair <CODE>    Approve a pairing code");
    console.log("    pair reject    Reject a pairing code");
    console.log("    pair policy    Set DM policy for a channel");
    console.log("  mcp         MCP server commands");
    console.log("    mcp list     List installed MCP servers");
    console.log("    mcp search   Search MCP registry");
    console.log("    mcp install  Install MCP server");
    console.log("    mcp popular  Show popular servers");
    console.log("  lsp         Language Server commands");
    console.log("    lsp list       Show language server status");
    console.log("    lsp install    Install language server");
    console.log("    lsp uninstall  Uninstall language server");
    console.log("  start       Start the server");
    console.log("  wizard      Run setup wizard (first-time configuration)");
    console.log("  help        Show this help");
    console.log("");
    console.log(`Version: ${getVersion()}`);
    console.log(`Environment: CYBARA_API=${API_BASE}`);
}



const Logo = ({ compact = false }: { compact?: boolean }) => (
    <Box flexDirection="column" alignItems="center" marginBottom={compact ? 0 : 1}>
        {!compact && (
            <Gradient name="rainbow">
                <BigText text="Cybara" font="chrome" />
            </Gradient>
        )}
        <Text color="gray">Cybara TUI</Text>
    </Box>
);

const Table = ({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) => (
    <Box flexDirection="column">
        <Box>
            {headers.map((h, i) => (
                <Box key={i} width={i === 0 ? 20 : 15} marginRight={1}>
                    <Text bold color="cyan">{h}</Text>
                </Box>
            ))}
        </Box>
        <Box marginBottom={1}>
            <Text color="gray">{"─".repeat(60)}</Text>
        </Box>
        {rows.map((row, i) => (
            <Box key={i}>
                {row.map((cell, j) => (
                    <Box key={j} width={j === 0 ? 20 : 15} marginRight={1}>
                        {typeof cell === "string" ? <Text>{cell}</Text> : cell}
                    </Box>
                ))}
            </Box>
        ))}
    </Box>
);

const StatusBadge = ({ status }: { status: string }) => {
    const colors: Record<string, string> = {
        healthy: "green",
        running: "green",
        active: "green",
        eligible: "green",
        stopped: "yellow",
        error: "red",
        blocked: "red",
    };
    return <Text color={colors[status] || "white"}>{status}</Text>;
};

const LoadingState = ({ message }: { message: string }) => (
    <Box>
        <Text color="yellow">
            <Spinner type="dots" /> {message}
        </Text>
    </Box>
);

const ErrorState = ({ message }: { message: string }) => (
    <Box>
        <Text color="red">✗ {message}</Text>
    </Box>
);


const TUIStatusCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<StatusResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<StatusResponse>("/api/health")
            .then((d) => {
                if (d) setData(d);
                else setError("Failed to connect to Cybara server");
            })
            .finally(() => setLoading(false));
    }, []);

    const formatUptime = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    if (loading) return <LoadingState message="Fetching status..." />;
    if (error) return <ErrorState message={error} />;
    if (!data) return <ErrorState message="No data" />;

    const checks = Object.entries(data.checks || {});

    return (
        <Box flexDirection="column">
            <Logo compact />
            <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
                <Text bold>System Status</Text>
                <Box marginTop={1}>
                    <Text color="gray">Status:  </Text>
                    <StatusBadge status={data.status} />
                </Box>
                <Box>
                    <Text color="gray">Uptime:  </Text>
                    <Text>{formatUptime(data.uptime)}</Text>
                </Box>
                <Box>
                    <Text color="gray">Time:    </Text>
                    <Text>{new Date(data.timestamp).toLocaleString()}</Text>
                </Box>
            </Box>
            {checks.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                    <Text bold color="cyan">Health Checks</Text>
                    {checks.map(([name, info]) => (
                        <Box key={name}>
                            <Box width={15}><Text color="gray">{name}</Text></Box>
                            <StatusBadge status={info.status} />
                            {info.total !== undefined && <Text color="gray"> ({info.total} total)</Text>}
                        </Box>
                    ))}
                </Box>
            )}
            <Box marginTop={1}>
                <Text color="gray">Press q to exit</Text>
            </Box>
        </Box>
    );
};


const TUIMetricsCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<MetricsResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<MetricsResponse>("/api/metrics/overview")
            .then((d) => {
                if (d) setData(d);
                else setError("Failed to fetch metrics");
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <LoadingState message="Fetching metrics..." />;
    if (error) return <ErrorState message={error} />;
    if (!data) return <ErrorState message="No data" />;

    return (
        <Box flexDirection="column">
            <Logo compact />
            <Box flexDirection="column" marginY={1} borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
                <Text bold>Token Metrics</Text>
                <Box marginTop={1}>
                    <Text color="gray">Total Tokens:   </Text>
                    <Text color="green">{(data.tokenUsage?.total || 0).toLocaleString()}</Text>
                </Box>
                <Box>
                    <Text color="gray">Input Tokens:   </Text>
                    <Text>{(data.tokenUsage?.input || 0).toLocaleString()}</Text>
                </Box>
                <Box>
                    <Text color="gray">Output Tokens:  </Text>
                    <Text>{(data.tokenUsage?.output || 0).toLocaleString()}</Text>
                </Box>
                <Box>
                    <Text color="gray">Tool Calls:     </Text>
                    <Text>{(data.toolCalls?.totalCalls || 0).toLocaleString()}</Text>
                </Box>
                <Box>
                    <Text color="gray">API Calls:      </Text>
                    <Text>{(data.apiCalls?.totalCalls || 0).toLocaleString()}</Text>
                </Box>
            </Box>
            {data.fileOperations && (
                <Box flexDirection="column" marginTop={1}>
                    <Text bold color="cyan">File Operations</Text>
                    <Box>
                        <Box width={20}><Text color="gray">Files Read</Text></Box>
                        <Text>{(data.fileOperations.filesRead || 0).toLocaleString()}</Text>
                    </Box>
                    <Box>
                        <Box width={20}><Text color="gray">Files Written</Text></Box>
                        <Text>{(data.fileOperations.filesWritten || 0).toLocaleString()}</Text>
                    </Box>
                </Box>
            )}
            <Box marginTop={1}>
                <Text color="gray">Press q to exit</Text>
            </Box>
        </Box>
    );
};


const TUISkillsCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<SkillItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<{ skills: SkillItem[] }>("/api/skills/status")
            .then((d) => {
                if (d) setData(d.skills || []);
                else setError("Failed to fetch skills");
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <LoadingState message="Fetching skills..." />;
    if (error) return <ErrorState message={error} />;

    const eligible = data.filter((s) => s.eligible).length;

    return (
        <Box flexDirection="column">
            <Logo compact />
            <Box marginY={1}>
                <Text bold color="cyan">Skills ({eligible}/{data.length} eligible)</Text>
            </Box>
            {data.length === 0 ? (
                <Text color="gray">No skills installed</Text>
            ) : (
                <Table
                    headers={["Name", "Status", "Source"]}
                    rows={data.map((s) => [
                        s.name,
                        <StatusBadge key={s.name} status={s.eligible ? "eligible" : "blocked"} />,
                        s.source,
                    ])}
                />
            )}
            <Box marginTop={1}>
                <Text color="gray">Press q to exit</Text>
            </Box>
        </Box>
    );
};


const TUIAgentsCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<AgentItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<AgentItem[]>("/api/agents")
            .then((d) => {
                if (d) setData(Array.isArray(d) ? d : []);
                else setError("Failed to fetch agents");
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <LoadingState message="Fetching agents..." />;
    if (error) return <ErrorState message={error} />;

    return (
        <Box flexDirection="column">
            <Logo compact />
            <Box marginY={1}>
                <Text bold color="cyan">Agents ({data.length})</Text>
            </Box>
            {data.length === 0 ? (
                <Text color="gray">No agents configured</Text>
            ) : (
                <Table
                    headers={["Name", "Type", "Status", "Model"]}
                    rows={data.map((a) => [
                        a.name,
                        a.type,
                        <StatusBadge key={a.id} status={a.status} />,
                        a.model || "-",
                    ])}
                />
            )}
            <Box marginTop={1}>
                <Text color="gray">Press q to exit</Text>
            </Box>
        </Box>
    );
};


const TUITasksCommand = () => {
    const { exit } = useApp();
    const [data, setData] = React.useState<TaskItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    useInput((input) => {
        if (input === "q") exit();
    });

    React.useEffect(() => {
        fetchAPI<TaskItem[]>("/api/tasks")
            .then((d) => {
                if (d) setData(Array.isArray(d) ? d : []);
                else setError("Failed to fetch tasks");
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <LoadingState message="Fetching tasks..." />;
    if (error) return <ErrorState message={error} />;

    return (
        <Box flexDirection="column">
            <Logo compact />
            <Box marginY={1}>
                <Text bold color="cyan">Scheduled Tasks ({data.length})</Text>
            </Box>
            {data.length === 0 ? (
                <Text color="gray">No tasks scheduled</Text>
            ) : (
                <Table
                    headers={["Name", "Status", "Schedule"]}
                    rows={data.map((t) => [
                        t.name,
                        <StatusBadge key={t.id} status={t.status} />,
                        t.schedule || "-",
                    ])}
                />
            )}
            <Box marginTop={1}>
                <Text color="gray">Press q to exit</Text>
            </Box>
        </Box>
    );
};


const MainMenu = () => {
    const { exit } = useApp();
    const [selected, setSelected] = React.useState(0);
    const [status, setStatus] = React.useState<{ message: string; type: "info" | "success" | "error" | "loading" } | null>(null);

    const menuItems = [
        { label: "Start Server", action: "start" },
        { label: "View Status", action: "status" },
        { label: "View Metrics", action: "metrics" },
        { label: "View Skills", action: "skills" },
        { label: "View Agents", action: "agents" },
        { label: "View Tasks", action: "tasks" },
        { label: "Open Web UI", action: "ui" },
        { label: "Exit", action: "exit" },
    ];

    useInput((input, key) => {
        if (key.upArrow) {
            setSelected((s) => (s > 0 ? s - 1 : menuItems.length - 1));
        } else if (key.downArrow) {
            setSelected((s) => (s < menuItems.length - 1 ? s + 1 : 0));
        } else if (key.return) {
            handleAction(menuItems[selected].action);
        } else if (input === "q") {
            exit();
        }
    });

    const handleAction = async (action: string) => {
        switch (action) {
            case "start":
                setStatus({ message: "Starting Cybara server...", type: "loading" });
                spawn("bun", ["run", "dev"], { stdio: "inherit" });
                break;
            case "status":
            case "metrics":
            case "skills":
            case "agents":
            case "tasks":

                render(<TUIApp command={action} />);
                break;
            case "ui":
                setStatus({ message: "Opening browser...", type: "info" });
                spawn("open", [`${API_BASE}`]);
                break;
            case "exit":
                exit();
                break;
        }
    };

    return (
        <Box flexDirection="column">
            <Logo />
            <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
                <Text bold>Main Menu</Text>
                {menuItems.map((item, i) => (
                    <Text key={item.action} color={i === selected ? "cyan" : "white"}>
                        {i === selected ? "❯ " : "  "}{item.label}
                    </Text>
                ))}
            </Box>
            {status && (
                <Box marginY={1}>
                    {status.type === "loading" ? (
                        <Text color="yellow"><Spinner type="dots" /> {status.message}</Text>
                    ) : (
                        <Text color={status.type === "success" ? "green" : status.type === "error" ? "red" : "cyan"}>
                            {status.type === "success" ? "✓" : status.type === "error" ? "✗" : "→"} {status.message}
                        </Text>
                    )}
                </Box>
            )}
            <Box marginTop={1}>
                <Text color="gray">↑/↓ Navigate • Enter Select • q Quit</Text>
            </Box>
        </Box>
    );
};


interface ProviderOption {
    id: string;
    name: string;
    description: string;
    requiresApiKey: boolean;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
    { id: "anthropic", name: "Anthropic", description: "Claude models (3.5 Sonnet, Opus, Haiku)", requiresApiKey: true },
    { id: "openai", name: "OpenAI", description: "GPT-4o, GPT-4, GPT-3.5", requiresApiKey: true },
    { id: "gemini", name: "Google Gemini", description: "Gemini Pro, Ultra models", requiresApiKey: true },
    { id: "openrouter", name: "OpenRouter", description: "Access many models via OpenRouter", requiresApiKey: true },
    { id: "ollama", name: "Ollama (Local)", description: "Run models locally with Ollama", requiresApiKey: false },
    { id: "lmstudio", name: "LM Studio (Local)", description: "Local models via LM Studio", requiresApiKey: false },
];


const SetupWizard = () => {
    const { exit } = useApp();
    const [step, setStep] = React.useState<"welcome" | "provider" | "apikey" | "agent" | "complete">("welcome");
    const [selectedProvider, setSelectedProvider] = React.useState(0);
    const [apiKey, setApiKey] = React.useState("");
    const [status, setStatus] = React.useState<{ message: string; type: "info" | "success" | "error" | "loading" } | null>(null);
    const [providerCreated, setProviderCreated] = React.useState(false);

    useInput((input, key) => {
        if (step === "welcome") {
            if (key.return || input === " ") {
                setStep("provider");
            } else if (input === "q") {
                exit();
            }
        } else if (step === "provider") {
            if (key.upArrow) {
                setSelectedProvider((s) => (s > 0 ? s - 1 : PROVIDER_OPTIONS.length - 1));
            } else if (key.downArrow) {
                setSelectedProvider((s) => (s < PROVIDER_OPTIONS.length - 1 ? s + 1 : 0));
            } else if (key.return) {
                const provider = PROVIDER_OPTIONS[selectedProvider];
                if (provider.requiresApiKey) {
                    setStep("apikey");
                } else {

                    createProvider(provider.id, "");
                }
            } else if (input === "q") {
                exit();
            }
        } else if (step === "apikey") {
            if (key.return) {
                if (apiKey.length > 0) {
                    createProvider(PROVIDER_OPTIONS[selectedProvider].id, apiKey);
                }
            } else if (key.backspace || key.delete) {
                setApiKey((k) => k.slice(0, -1));
            } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
                setApiKey((k) => k + input);
            } else if (input === "") {

                exit();
            }
        } else if (step === "agent") {
            if (key.return || input === "y" || input === "Y") {
                createDefaultAgent();
            } else if (input === "n" || input === "N") {
                completeSetup();
            }
        } else if (step === "complete") {
            if (key.return || input === " " || input === "q") {
                exit();
            }
        }
    });

    const createProvider = async (providerId: string, key: string) => {
        setStatus({ message: "Creating provider...", type: "loading" });

        const result = await fetchAPI<{ id?: string; error?: string }>("/api/providers", {
            method: "POST",
            body: JSON.stringify({
                provider: providerId,
                name: PROVIDER_OPTIONS.find(p => p.id === providerId)?.name || providerId,
                api_key: key || undefined,
                is_default: true,
            }),
        });

        if (result?.id) {
            setProviderCreated(true);
            setStatus({ message: "Provider created!", type: "success" });
            setTimeout(() => {
                setStatus(null);
                setStep("agent");
            }, 1000);
        } else {
            setStatus({ message: result?.error || "Failed to create provider", type: "error" });
        }
    };

    const createDefaultAgent = async () => {
        setStatus({ message: "Creating default agent...", type: "loading" });

        const result = await fetchAPI<{ id?: string; error?: string }>("/api/agents/default", {
            method: "POST",
        });

        if (result?.id || result?.error === "Default agent already exists") {
            setStatus({ message: "Agent ready!", type: "success" });
            setTimeout(() => completeSetup(), 1000);
        } else {
            setStatus({ message: result?.error || "Failed to create agent", type: "error" });
            setTimeout(() => completeSetup(), 2000);
        }
    };

    const completeSetup = async () => {
        await fetchAPI("/api/setup/complete", { method: "POST" });
        setStep("complete");
    };

    return (
        <Box flexDirection="column">
            <Logo />
            <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
                {step === "welcome" && (
                    <>
                        <Text bold>Welcome to Cybara! 🚀</Text>
                        <Box marginTop={1}>
                            <Text>This wizard will help you set up Cybara for first use.</Text>
                        </Box>
                        <Box marginTop={1}>
                            <Text color="gray">We'll configure:</Text>
                        </Box>
                        <Box marginLeft={2} flexDirection="column">
                            <Text color="gray">• An AI provider (OpenAI, Anthropic, etc.)</Text>
                            <Text color="gray">• A default agent to chat with</Text>
                        </Box>
                        <Box marginTop={2}>
                            <Text color="green" bold>Press ENTER to begin</Text>
                        </Box>
                    </>
                )}

                {step === "provider" && (
                    <>
                        <Text bold>Select AI Provider</Text>
                        <Box marginTop={1} flexDirection="column">
                            {PROVIDER_OPTIONS.map((p, i) => (
                                <Box key={p.id}>
                                    <Text color={i === selectedProvider ? "cyan" : "white"}>
                                        {i === selectedProvider ? "❯ " : "  "}
                                        {p.name}
                                    </Text>
                                    <Text color="gray"> - {p.description}</Text>
                                </Box>
                            ))}
                        </Box>
                        <Box marginTop={1}>
                            <Text color="gray">↑↓ to select, ENTER to confirm</Text>
                        </Box>
                    </>
                )}

                {step === "apikey" && (
                    <>
                        <Text bold>Enter API Key for {PROVIDER_OPTIONS[selectedProvider].name}</Text>
                        <Box marginTop={1}>
                            <Text color="gray">API Key: </Text>
                            <Text>{apiKey.length > 0 ? "•".repeat(apiKey.length) : "(type your key)"}</Text>
                        </Box>
                        <Box marginTop={1}>
                            <Text color="gray">Press ENTER when done</Text>
                        </Box>
                    </>
                )}

                {step === "agent" && (
                    <>
                        <Text bold>Create Default Agent?</Text>
                        <Box marginTop={1}>
                            <Text>This creates a general-purpose AI assistant agent.</Text>
                        </Box>
                        <Box marginTop={1}>
                            <Text color="green">Y</Text>
                            <Text> - Yes, create it  </Text>
                            <Text color="yellow">N</Text>
                            <Text> - No, I'll configure later</Text>
                        </Box>
                    </>
                )}

                {step === "complete" && (
                    <>
                        <Text bold color="green">✓ Setup Complete!</Text>
                        <Box marginTop={1} flexDirection="column">
                            <Text>Cybara is ready to use. Here's what you can do:</Text>
                        </Box>
                        <Box marginTop={1} marginLeft={2} flexDirection="column">
                            <Text color="cyan">• Open the dashboard: </Text>
                            <Text color="white">  http://localhost:4269</Text>
                            <Text color="cyan">• Chat in terminal: </Text>
                            <Text color="white">  cybara chat "Hello!"</Text>
                            <Text color="cyan">• Configure more: </Text>
                            <Text color="white">  Settings → Providers / Agents</Text>
                        </Box>
                        <Box marginTop={2}>
                            <Text color="gray">Press ENTER to exit</Text>
                        </Box>
                    </>
                )}
            </Box>
            {status && (
                <Box marginTop={1}>
                    {status.type === "loading" ? (
                        <Text color="yellow"><Spinner type="dots" /> {status.message}</Text>
                    ) : status.type === "success" ? (
                        <Text color="green">✓ {status.message}</Text>
                    ) : status.type === "error" ? (
                        <Text color="red">✗ {status.message}</Text>
                    ) : (
                        <Text color="blue">ℹ {status.message}</Text>
                    )}
                </Box>
            )}
        </Box>
    );
};


const TUIApp = ({ command }: { command?: string }) => {
    switch (command) {
        case "wizard":
        case "setup":
        case "install":
            return <SetupWizard />;
        case "status":
            return <TUIStatusCommand />;
        case "metrics":
            return <TUIMetricsCommand />;
        case "tasks":
            return <TUITasksCommand />;
        case "skills":
            return <TUISkillsCommand />;
        case "agents":
            return <TUIAgentsCommand />;
        default:
            return <MainMenu />;
    }
};

const args = process.argv.slice(2);
const command = args[0];

function getVersion(): string {
    try {
        const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
        return pkg.version || "unknown";
    } catch {
        return "unknown";
    }
}

async function main() {
    switch (command) {
        case "status":
            await rawStatus();
            break;
        case "metrics":
            await rawMetrics();
            break;
        case "agents":
            await rawAgents();
            break;
        case "tasks":
            await rawTasks();
            break;
        case "skills":
            await rawSkills();
            break;

        case "provider":
        case "providers": {
            const provSubCmd = args[1];
            const provArg = args[2];
            switch (provSubCmd) {
                case "list":
                case undefined:
                    await rawProviders();
                    break;
                case "available":
                    await rawProviderAvailable();
                    break;
                case "add": {
                    const flags = parseProviderFlags(args.slice(3));
                    await rawProviderAdd(provArg, flags.name, flags.key, flags.token, flags.isDefault);
                    break;
                }
                case "update": {
                    const uFlags = parseProviderFlags(args.slice(3));
                    await rawProviderUpdate(provArg, uFlags.name, uFlags.key, uFlags.token, uFlags.isDefault);
                    break;
                }
                case "delete":
                case "remove":
                    await rawProviderDelete(provArg);
                    break;
                case "models":
                    await rawProviderModels(provArg);
                    break;
                case "discover":
                    await rawProviderDiscover();
                    break;
                default:
                    console.log("Provider Commands:");
                    console.log("  cybara provider              - List configured providers");
                    console.log("  cybara provider available     - Show available provider types");
                    console.log("  cybara provider add <type>    - Add provider");
                    console.log("    --name NAME   Display name");
                    console.log("    --key KEY     API key");
                    console.log("    --token TOK   Access token");
                    console.log("    --default     Set as default");
                    console.log("  cybara provider update <id>   - Update provider");
                    console.log("  cybara provider delete <id>   - Delete provider");
                    console.log("  cybara provider models <id>   - List provider models");
                    console.log("  cybara provider discover      - Discover Ollama models");
                    break;
            }
            break;
        }
        case "sessions":
            await rawSessions();
            break;
        case "memory":
            await rawMemory(args[1]);
            break;
        case "logs":
            await rawLogs(args[1] ? parseInt(args[1]) : 20);
            break;
        case "subagent":
        case "subagents":
            switch (args[1]) {
                case "list":
                case undefined:
                    await rawSubagents();
                    break;
                case "spawn":
                    await rawSubagentSpawn(args.slice(2).join(" "));
                    break;
                case "kill":
                    await rawSubagentKill(args[2]);
                    break;
                default:
                    console.log("Subagent Commands:");
                    console.log("  cybara subagent list       - List all subagents");
                    console.log("  cybara subagent spawn <t>  - Spawn with task");
                    console.log("  cybara subagent kill <id>  - Kill subagent");
                    break;
            }
            break;
        case "browser":
            switch (args[1]) {
                case "tabs":
                    await rawBrowserProfiles();
                    break;
                default:
                    await rawBrowser();
                    break;
            }
            break;
        case "channels":
        case "channel":
            await rawChannels();
            break;

        case "help":
        case "--help":
        case "-h":
            rawHelp();
            break;

        case "--version":
        case "-v":
            console.log(`cybara v${getVersion()}`);
            break;

        case "pair": {
            const pairSubCmd = args[1];
            if (!pairSubCmd || pairSubCmd === "list") {
                await rawPairList();
            } else if (pairSubCmd === "reject") {
                const rejectCode = args[2];
                if (!rejectCode) {
                    console.error("Usage: cybara pair reject <CODE>");
                    process.exit(1);
                }
                await rawPairReject(rejectCode);
            } else if (pairSubCmd === "policy") {
                const channelName = args[2];
                const policy = args[3];
                if (!channelName || !policy) {
                    console.error("Usage: cybara pair policy <channel> <policy>");
                    console.log("Policies: pairing, allowlist, open, disabled");
                    process.exit(1);
                }
                await rawPairPolicy(channelName, policy);
            } else {
                await rawPairApprove(pairSubCmd);
            }
            break;
        }

        case "mcp": {
            const mcpSubCmd = args[1];
            const mcpArg = args[2];
            switch (mcpSubCmd) {
                case "search":
                    if (!mcpArg) {
                        console.error("Usage: cybara mcp search <query>");
                        process.exit(1);
                    }
                    await rawMcpSearch(mcpArg);
                    break;
                case "install":
                    if (!mcpArg) {
                        console.error("Usage: cybara mcp install <package>");
                        process.exit(1);
                    }
                    await rawMcpInstall(mcpArg);
                    break;
                case "list":
                    await rawMcpList();
                    break;
                case "popular":
                    await rawMcpPopular();
                    break;
                default:
                    console.log("MCP Commands:");
                    console.log("  cybara mcp list       - List installed servers");
                    console.log("  cybara mcp search <q> - Search registry");
                    console.log("  cybara mcp install <p> - Install package");
                    console.log("  cybara mcp popular    - Show popular servers");
                    break;
            }
            break;
        }
        case "lsp":
            switch (args[1]) {
                case "list":
                case undefined:
                    await rawLsp();
                    break;
                case "install":
                    await rawLspInstall(args[2]);
                    break;
                case "uninstall":
                    await rawLspUninstall(args[2]);
                    break;
                default:
                    console.log("LSP Commands:");
                    console.log("  cybara lsp list             - Show language server status");
                    console.log("  cybara lsp install <lang>   - Install language server");
                    console.log("  cybara lsp uninstall <lang> - Uninstall language server");
                    console.log("");
                    console.log("Languages: rust, go, python, cpp (C/C++), java, csharp, ruby, php, lua, zig, kotlin, swift");
                    break;
            }
            break;

        case "start":
        case "dev":
            spawn("bun", ["run", "dev"], { stdio: "inherit" });
            break;

        case "wizard":
        case "setup":
        case "install":
        case "tui":
            render(<TUIApp command={command === "tui" ? undefined : command} />);
            break;

        default:
            render(<TUIApp />);
            break;
    }
}

main();
