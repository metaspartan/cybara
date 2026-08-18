import { existsSync, readFileSync } from "fs";
import { isAbsolute, resolve, sep } from "path";
import { registerAgentHook, type AgentHookDecision, type AgentHookEvent } from "../agent-hooks";
import { mcpManager } from "../mcp";
import { validatePublicHttpUrlShape } from "../outbound-url-policy";
import { redactSecrets } from "../redaction";
import { readSubprocessStreamAsText } from "../subprocess-output";
import { toolSchemas, type Tool, type ToolContext } from "../tools";
import { registerToolHandler, unregisterToolHandler } from "../tools/handlers";
import { buildSubprocessEnvironment } from "../subprocess-env";
import type { InstalledCybaraPlugin } from "./types";
import {
  registerPluginProviderContribution,
  unregisterPluginProviderContribution,
} from "./provider-registry";
export {
  getPluginProviderContribution,
  listPluginProviderContributions,
  type PluginProviderContribution,
} from "./provider-registry";

export interface PluginCommandContribution {
  pluginId: string;
  id: string;
  description: string;
  prompt: string;
}

export interface PluginChannelContribution {
  pluginId: string;
  id: string;
  name: string;
  transport: "webhook";
  description: string;
}

interface PluginToolContribution {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  input_schema?: Record<string, unknown>;
  permissions?: string[];
  command: string[];
  timeoutMs?: number;
}

interface PluginHookContribution {
  events: string[];
  command: string[];
  timeoutMs?: number;
}

interface PluginMcpContribution {
  name: string;
  command?: string;
  args?: string | string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}

interface ActivePluginRuntime {
  unregister: Array<() => void>;
}

const activePlugins = new Map<string, ActivePluginRuntime>();
const commands = new Map<string, PluginCommandContribution>();
const channels = new Map<string, PluginChannelContribution>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readDefinitions(files: string[]): unknown[] {
  return files.flatMap((file) => {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function boundedTimeout(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(300_000, Math.max(1_000, Math.floor(value)))
    : 30_000;
}

function resolveExecutable(rootDir: string, executable: string): string {
  if (isAbsolute(executable)) throw new Error("Plugin commands cannot use absolute executables");
  if (!executable.startsWith(".")) return executable;
  const candidate = resolve(rootDir, executable);
  const normalizedRoot = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
  if (!candidate.startsWith(normalizedRoot) || !existsSync(candidate)) {
    throw new Error("Plugin command executable must exist inside the plugin root");
  }
  return candidate;
}

async function runPluginCommand(
  plugin: InstalledCybaraPlugin,
  command: string[],
  input: unknown,
  timeoutMs: number
): Promise<unknown> {
  if (command.length === 0) throw new Error("Plugin command is required");
  const proc = Bun.spawn(
    [resolveExecutable(plugin.rootDir, command[0] || ""), ...command.slice(1)],
    {
      cwd: plugin.rootDir,
      stdin: new Blob([JSON.stringify(redactSecrets(input))]),
      stdout: "pipe",
      stderr: "pipe",
      env: buildSubprocessEnvironment({ CYBARA_PLUGIN_ID: plugin.manifest.id }),
    }
  );
  const stdoutPromise = readSubprocessStreamAsText(proc.stdout);
  const stderrPromise = readSubprocessStreamAsText(proc.stderr);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`Plugin command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const exitCode = await Promise.race([proc.exited, timeout]);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    if (exitCode !== 0) throw new Error(stderr.trim() || `Plugin command exited with ${exitCode}`);
    const output = stdout.trim();
    if (!output) return { success: true };
    try {
      return JSON.parse(output) as unknown;
    } catch {
      return output;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pluginToolName(pluginId: string, name: string): string {
  const normalizedPlugin = pluginId.replace(/[^a-zA-Z0-9_]/g, "_");
  const normalizedName = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return `plugin_${normalizedPlugin}_${normalizedName}`;
}

function activateTools(plugin: InstalledCybaraPlugin, runtime: ActivePluginRuntime): void {
  for (const value of readDefinitions(plugin.contributionFiles.tools)) {
    const record = asRecord(value);
    if (!record) throw new Error("Plugin tool contribution must be an object");
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    const command = stringArray(record.command);
    if (!name || !description || command.length === 0) {
      throw new Error("Plugin tools require name, description, and command");
    }
    const definition = record as unknown as PluginToolContribution;
    const qualifiedName = pluginToolName(plugin.manifest.id, name);
    const inputSchema = definition.inputSchema ||
      definition.input_schema || { type: "object", properties: {} };
    const schema: Omit<Tool, "handler"> = {
      name: qualifiedName,
      description,
      category: "skill",
      input_schema: inputSchema,
      permissions: [...new Set([...(definition.permissions || []), "exec:run"])],
    };
    toolSchemas[qualifiedName] = schema;
    registerToolHandler(
      qualifiedName,
      async (args: Record<string, unknown>, context?: ToolContext) =>
        await runPluginCommand(
          plugin,
          command,
          { args, context },
          boundedTimeout(definition.timeoutMs)
        )
    );
    runtime.unregister.push(() => {
      unregisterToolHandler(qualifiedName);
      delete toolSchemas[qualifiedName];
    });
  }
}

function activateCommands(plugin: InstalledCybaraPlugin, runtime: ActivePluginRuntime): void {
  for (const value of readDefinitions(plugin.contributionFiles.commands)) {
    const record = asRecord(value);
    const id = typeof record?.id === "string" ? record.id.trim().replace(/^\//, "") : "";
    const description = typeof record?.description === "string" ? record.description.trim() : "";
    const prompt = typeof record?.prompt === "string" ? record.prompt.trim() : "";
    if (!id || !description || !prompt)
      throw new Error("Plugin commands require id, description, and prompt");
    const key = `${plugin.manifest.id}:${id}`;
    commands.set(key, { pluginId: plugin.manifest.id, id, description, prompt });
    runtime.unregister.push(() => void commands.delete(key));
  }
}

function hookDecision(value: unknown): AgentHookDecision | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    block: record.block === true,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    transformedResult: record.transformedResult,
    transformedContent:
      typeof record.transformedContent === "string" ? record.transformedContent : undefined,
    transformedOutput:
      typeof record.transformedOutput === "string" ? record.transformedOutput : undefined,
  };
}

function activateHooks(plugin: InstalledCybaraPlugin, runtime: ActivePluginRuntime): void {
  for (const value of readDefinitions(plugin.contributionFiles.hooks)) {
    const record = asRecord(value);
    const events = stringArray(record?.events);
    const command = stringArray(record?.command);
    if (events.length === 0 || command.length === 0) {
      throw new Error("Plugin hooks require events and command");
    }
    const definition = record as unknown as PluginHookContribution;
    const registration = registerAgentHook(async (event: AgentHookEvent) => {
      if (!events.includes(event.type) && !events.includes("*")) return undefined;
      return hookDecision(
        await runPluginCommand(plugin, command, event, boundedTimeout(definition.timeoutMs))
      );
    });
    runtime.unregister.push(registration.unregister);
  }
}

function activateMcpServers(plugin: InstalledCybaraPlugin, runtime: ActivePluginRuntime): void {
  for (const value of readDefinitions(plugin.contributionFiles.mcpServers)) {
    const record = asRecord(value);
    const name = typeof record?.name === "string" ? record.name.trim() : "";
    if (!name) throw new Error("Plugin MCP servers require a name");
    const definition = record as unknown as PluginMcpContribution;
    const serverName = `${plugin.manifest.name}: ${name}`;
    const existing = mcpManager.list().find((server) => server.name === serverName);
    const created = existing
      ? mcpManager.get(existing.id)
      : mcpManager.create({
          name: serverName,
          command: definition.command,
          args: Array.isArray(definition.args) ? definition.args.join(" ") : definition.args,
          env: definition.env
            ? Object.entries(definition.env)
                .map(([key, entry]) => `${key}=${entry}`)
                .join(",")
            : undefined,
          url: definition.url,
          enabled: definition.enabled,
        });
    if (created && !existing) runtime.unregister.push(() => void mcpManager.delete(created.id));
  }
}

function activateProviders(plugin: InstalledCybaraPlugin, runtime: ActivePluginRuntime): void {
  for (const value of readDefinitions(plugin.contributionFiles.providers)) {
    const record = asRecord(value);
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    const name = typeof record?.name === "string" ? record.name.trim() : "";
    const baseUrl =
      typeof record?.baseUrl === "string"
        ? new URL(record.baseUrl).toString().replace(/\/$/, "")
        : "";
    const api =
      record?.api === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible";
    if (!id || !name || !baseUrl) throw new Error("Plugin providers require id, name, and baseUrl");
    const allowPrivateEndpoint = record?.allowPrivateEndpoint === true;
    if (!allowPrivateEndpoint) {
      const validation = validatePublicHttpUrlShape(baseUrl);
      if (!validation.valid) {
        throw new Error(`Plugin provider endpoint is not public: ${validation.error}`);
      }
    }
    const key = `${plugin.manifest.id}:${id}`;
    registerPluginProviderContribution(key, {
      pluginId: plugin.manifest.id,
      id,
      runtimeId: `plugin:${plugin.manifest.id}:${id}`,
      name,
      baseUrl,
      api,
      authType: record?.authType === "none" ? "none" : "api-key",
      allowPrivateEndpoint,
      models: stringArray(record?.models),
    });
    runtime.unregister.push(() => unregisterPluginProviderContribution(key));
  }
}

function activateChannels(plugin: InstalledCybaraPlugin, runtime: ActivePluginRuntime): void {
  for (const value of readDefinitions(plugin.contributionFiles.channels)) {
    const record = asRecord(value);
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    const name = typeof record?.name === "string" ? record.name.trim() : "";
    const description = typeof record?.description === "string" ? record.description.trim() : "";
    if (!id || !name || record?.transport !== "webhook") {
      throw new Error("Plugin channels require id, name, and webhook transport");
    }
    const key = `${plugin.manifest.id}:${id}`;
    channels.set(key, {
      pluginId: plugin.manifest.id,
      id,
      name,
      transport: "webhook",
      description,
    });
    runtime.unregister.push(() => void channels.delete(key));
  }
}

export function deactivatePluginRuntime(pluginId: string): void {
  const runtime = activePlugins.get(pluginId);
  if (!runtime) return;
  for (const unregister of runtime.unregister.reverse()) unregister();
  activePlugins.delete(pluginId);
}

export function activatePluginRuntime(plugin: InstalledCybaraPlugin): void {
  deactivatePluginRuntime(plugin.manifest.id);
  if (!plugin.enabled || plugin.builtIn) return;
  const runtime: ActivePluginRuntime = { unregister: [] };
  try {
    activateTools(plugin, runtime);
    activateCommands(plugin, runtime);
    activateHooks(plugin, runtime);
    activateMcpServers(plugin, runtime);
    activateProviders(plugin, runtime);
    activateChannels(plugin, runtime);
    activePlugins.set(plugin.manifest.id, runtime);
  } catch (error) {
    for (const unregister of runtime.unregister.reverse()) unregister();
    throw error;
  }
}

export function activateInstalledPluginRuntimes(plugins: InstalledCybaraPlugin[]): void {
  const installedIds = new Set(plugins.map((plugin) => plugin.manifest.id));
  for (const activeId of [...activePlugins.keys()]) {
    if (!installedIds.has(activeId)) deactivatePluginRuntime(activeId);
  }
  for (const plugin of plugins) activatePluginRuntime(plugin);
}

export function listPluginCommands(): PluginCommandContribution[] {
  return [...commands.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function listPluginChannelContributions(): PluginChannelContribution[] {
  return [...channels.values()].sort((left, right) => left.name.localeCompare(right.name));
}
