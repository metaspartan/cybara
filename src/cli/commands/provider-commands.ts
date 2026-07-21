import { connectCliProviderOAuth } from "./provider-oauth";

export type CliProviderFetch = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;
export type CliProviderAuthHeaders = (
  headers?: RequestInit["headers"],
  ensureJsonContentType?: boolean
) => Headers;

export interface ProviderInfo {
  id: string;
  provider: string;
  name: string;
  is_default: boolean;
  config?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface AvailableProviderInfo {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: string;
  oauthFlow?: "device_code" | "redirect" | null;
  hasOAuthConfig?: boolean;
  apiConsoleUrl?: string | null;
  models: { id: string; name: string; context: number }[];
}

export interface ProviderFlags {
  name?: string;
  key?: string;
  token?: string;
  isDefault: boolean;
  oauth: boolean;
}

export interface ProviderAccountPoolInfo {
  id: string;
  name: string;
  provider: string;
  enabled: boolean;
  routing_mode: "usage" | "priority_then_usage";
  accounts: Array<{ provider_id: string; provider_name?: string; priority: number | null }>;
}

export interface ProviderPoolFlags {
  name?: string;
  provider?: string;
  enabled?: boolean;
  accounts?: Array<{ provider_id: string; priority?: number }>;
}

interface CliProviderCommands {
  add: (
    type: string,
    name?: string,
    apiKey?: string,
    accessToken?: string,
    isDefault?: boolean,
    useOAuth?: boolean
  ) => Promise<void>;
  available: () => Promise<void>;
  delete: (id: string) => Promise<void>;
  discover: () => Promise<void>;
  list: () => Promise<void>;
  models: (id: string) => Promise<void>;
  parseFlags: (args: string[]) => ProviderFlags;
  parsePoolFlags: (args: string[]) => ProviderPoolFlags;
  poolCreate: (flags: ProviderPoolFlags) => Promise<void>;
  poolDelete: (id: string) => Promise<void>;
  poolList: () => Promise<void>;
  poolUpdate: (id: string, flags: ProviderPoolFlags) => Promise<void>;
  update: (
    id: string,
    name?: string,
    apiKey?: string,
    accessToken?: string,
    isDefault?: boolean
  ) => Promise<void>;
}

function connectionErrorMessage(error: unknown, action: string, apiBase: string): string[] {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
    return [
      `ERROR: Cannot connect to Cybara at ${apiBase}`,
      "Is the server running? Start it with: cybara start",
    ];
  }
  return [`${action}: ${message}`];
}

function exitWithError(lines: string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

export function createCliProviderCommands(
  fetchAPI: CliProviderFetch,
  apiBase: string,
  withAuthHeaders: CliProviderAuthHeaders
): CliProviderCommands {
  const list = async (): Promise<void> => {
    const data = await fetchAPI<ProviderInfo[]>("/api/providers");
    if (!data) exitWithError(["ERROR: Failed to fetch providers from", apiBase]);
    const providers = Array.isArray(data) ? data : [];
    console.log("CYBARA PROVIDERS");
    console.log("================");
    console.log(`total: ${providers.length}`);
    console.log("");
    if (providers.length === 0) {
      console.log("No providers configured");
      console.log("Run 'cybara provider add <type>' to add one");
      console.log("Run 'cybara provider available' to see available types");
      return;
    }
    for (const provider of providers) {
      const defaultLabel = provider.is_default ? " [DEFAULT]" : "";
      console.log(
        `  ${provider.id.slice(0, 8)}  ${provider.name} (${provider.provider})${defaultLabel}`
      );
    }
  };

  const available = async (): Promise<void> => {
    const data = await fetchAPI<AvailableProviderInfo[]>("/api/providers/available");
    if (!data) exitWithError(["ERROR: Failed to fetch available providers from", apiBase]);
    console.log("AVAILABLE PROVIDER TYPES");
    console.log("========================");
    console.log("");
    for (const provider of data) {
      const auth = provider.authType === "none" ? "(no auth)" : `(${provider.authType})`;
      console.log(`  ${provider.id.padEnd(18)} ${provider.name} ${auth}`);
      console.log(`${"".padEnd(20)} ${provider.models.length} models | ${provider.baseUrl}`);
    }
  };

  const add = async (
    type: string,
    name?: string,
    apiKey?: string,
    accessToken?: string,
    isDefault?: boolean,
    useOAuth?: boolean
  ): Promise<void> => {
    if (!type) {
      console.error("ERROR: Please specify a provider type");
      console.log(
        "Usage: cybara provider add <type> [--name NAME] [--key KEY] [--token TOKEN] [--oauth] [--default]"
      );
      console.log("");
      console.log("Run 'cybara provider available' to see available types");
      process.exit(1);
    }

    const displayName = name || type.charAt(0).toUpperCase() + type.slice(1);
    let refreshToken: string | undefined;
    let expiresAt: number | undefined;
    if (useOAuth) {
      try {
        const providerTypes = await fetchAPI<AvailableProviderInfo[]>("/api/providers/available");
        const provider = providerTypes?.find((entry) => entry.id === type);
        if (!provider?.hasOAuthConfig || !provider.oauthFlow) {
          throw new Error(`OAuth is not configured for ${type}`);
        }
        const credentials = await connectCliProviderOAuth({
          apiBase,
          providerType: type,
          oauthFlow: provider.oauthFlow,
          headers: () => withAuthHeaders({ "Content-Type": "application/json" }),
          onVerification: ({ code, url }) => {
            console.log("");
            if (code) console.log(`  Code: ${code.padEnd(28)}`);
            console.log(`  Open: ${url}`);
            console.log("  Finish authorization in your browser.");
            console.log("");
            process.stdout.write("  Waiting for authorization");
          },
        });
        console.log(" ✓");
        accessToken = credentials.accessToken;
        refreshToken = credentials.refreshToken;
        expiresAt = credentials.expiresAt;
      } catch (error) {
        exitWithError(connectionErrorMessage(error, "✗ OAuth failed", apiBase));
      }
    }

    const body: Record<string, unknown> = { provider: type, name: displayName };
    if (apiKey) body.api_key = apiKey;
    if (accessToken) body.access_token = accessToken;
    if (refreshToken) body.refresh_token = refreshToken;
    if (expiresAt) body.expires_at = expiresAt;
    if (isDefault) body.is_default = true;
    try {
      const response = await fetch(`${apiBase}/api/providers`, {
        method: "POST",
        headers: withAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { id?: string; error?: string };
      if (!result.id) {
        exitWithError([`✗ Failed to add provider: ${result.error || "Unknown error"}`]);
      }
      console.log(`✓ Added provider: ${displayName} (${type})`);
      console.log(`  ID: ${result.id}`);
    } catch (error) {
      exitWithError(connectionErrorMessage(error, "✗ Failed to add provider", apiBase));
    }
  };

  const update = async (
    id: string,
    name?: string,
    apiKey?: string,
    accessToken?: string,
    isDefault?: boolean
  ): Promise<void> => {
    if (!id) {
      console.error("ERROR: Please specify a provider ID");
      console.log(
        "Usage: cybara provider update <id> [--name NAME] [--key KEY] [--token TOKEN] [--default]"
      );
      process.exit(1);
    }
    const body: Record<string, unknown> = {};
    if (name) body.name = name;
    if (apiKey) body.api_key = apiKey;
    if (accessToken) body.access_token = accessToken;
    if (isDefault !== undefined) body.is_default = isDefault;
    try {
      const response = await fetch(`${apiBase}/api/providers/${id}`, {
        method: "PUT",
        headers: withAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!result.success) {
        exitWithError([`✗ Failed to update: ${result.error || "Unknown error"}`]);
      }
      console.log(`✓ Updated provider: ${id}`);
    } catch (error) {
      exitWithError(connectionErrorMessage(error, "✗ Failed to update provider", apiBase));
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!id) {
      console.error("ERROR: Please specify a provider ID");
      console.log("Usage: cybara provider delete <id>");
      process.exit(1);
    }
    try {
      const response = await fetch(`${apiBase}/api/providers/${id}`, {
        method: "DELETE",
        headers: withAuthHeaders(),
      });
      const result = (await response.json()) as { success?: boolean; error?: string };
      if (!result.success) {
        exitWithError([`✗ Failed to delete: ${result.error || "Unknown error"}`]);
      }
      console.log(`✓ Deleted provider: ${id}`);
    } catch (error) {
      exitWithError(connectionErrorMessage(error, "✗ Failed to delete provider", apiBase));
    }
  };

  const models = async (id: string): Promise<void> => {
    if (!id) {
      console.error("ERROR: Please specify a provider ID");
      console.log("Usage: cybara provider models <id>");
      process.exit(1);
    }
    const data = await fetchAPI<{ id: string; name: string; context: number }[]>(
      `/api/providers/${id}/models`
    );
    if (!data) exitWithError(["ERROR: Failed to fetch models from", apiBase]);
    const providerModels = Array.isArray(data) ? data : [];
    console.log(`MODELS FOR PROVIDER ${id}`);
    console.log("=".repeat(26 + id.length));
    console.log(`total: ${providerModels.length}`);
    console.log("");
    for (const model of providerModels) {
      const context = model.context ? ` (${(model.context / 1000).toFixed(0)}k ctx)` : "";
      console.log(`  ${model.id.padEnd(30)} ${model.name}${context}`);
    }
  };

  const discover = async (): Promise<void> => {
    console.log("Discovering Ollama models...");
    try {
      const response = await fetch(`${apiBase}/api/providers/discover/ollama`, {
        method: "POST",
        headers: withAuthHeaders(),
      });
      const result = (await response.json()) as { models?: { id: string }[]; error?: string };
      if (!result.models) {
        exitWithError([`✗ Failed to discover: ${result.error || "Unable to reach Ollama"}`]);
      }
      console.log(`✓ Discovered ${result.models.length} Ollama models`);
      for (const model of result.models) console.log(`  - ${model.id}`);
    } catch (error) {
      exitWithError(connectionErrorMessage(error, "✗ Failed to discover Ollama models", apiBase));
    }
  };

  const parseFlags = (args: string[]): ProviderFlags => {
    let name: string | undefined;
    let key: string | undefined;
    let token: string | undefined;
    let isDefault = false;
    let oauth = false;
    for (let index = 0; index < args.length; index += 1) {
      switch (args[index]) {
        case "--name":
        case "-n":
          name = args[++index];
          break;
        case "--key":
        case "-k":
          key = args[++index];
          break;
        case "--token":
        case "-t":
          token = args[++index];
          break;
        case "--default":
        case "-d":
          isDefault = true;
          break;
        case "--oauth":
        case "-o":
          oauth = true;
          break;
      }
    }
    return { name, key, token, isDefault, oauth };
  };

  const parsePoolFlags = (args: string[]): ProviderPoolFlags => {
    let name: string | undefined;
    let provider: string | undefined;
    let enabled: boolean | undefined;
    const accounts: NonNullable<ProviderPoolFlags["accounts"]> = [];
    for (let index = 0; index < args.length; index += 1) {
      const flag = args[index];
      if (flag === "--name" || flag === "-n") name = args[++index];
      else if (flag === "--provider" || flag === "-p") provider = args[++index];
      else if (flag === "--enabled") enabled = true;
      else if (flag === "--disabled") enabled = false;
      else if (flag === "--account" || flag === "-a") {
        const value = args[++index] || "";
        const separator = value.lastIndexOf(":");
        const providerId = (separator > 0 ? value.slice(0, separator) : value).trim();
        const parsedPriority = separator > 0 ? Number(value.slice(separator + 1)) : undefined;
        if (providerId) {
          accounts.push(
            parsedPriority !== undefined && Number.isFinite(parsedPriority)
              ? {
                  provider_id: providerId,
                  priority: Math.max(0, Math.min(10_000, Math.round(parsedPriority))),
                }
              : {
                  provider_id: providerId,
                }
          );
        }
      }
    }
    return {
      ...(name !== undefined ? { name } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
      ...(accounts.length > 0 ? { accounts } : {}),
    };
  };

  const poolList = async (): Promise<void> => {
    const pools = await fetchAPI<ProviderAccountPoolInfo[]>("/api/provider-account-pools");
    if (!pools) exitWithError(["ERROR: Failed to fetch account pools from", apiBase]);
    console.log("PROVIDER ACCOUNT POOLS");
    console.log("======================");
    if (pools.length === 0) {
      console.log("No account pools configured");
      return;
    }
    for (const pool of pools) {
      console.log(
        `\n${pool.name}  ${pool.provider}  ${pool.enabled ? "active" : "paused"}  ${pool.routing_mode === "usage" ? "usage-balanced" : "priority override"}`
      );
      for (const [index, account] of pool.accounts.entries()) {
        console.log(
          `  ${index + 1}. ${account.provider_name || account.provider_id}  ${account.priority === null ? "automatic" : `priority ${account.priority}`}`
        );
      }
    }
  };

  const savePool = async (
    method: "POST" | "PUT",
    endpoint: string,
    flags: ProviderPoolFlags
  ): Promise<void> => {
    const response = await fetch(`${apiBase}${endpoint}`, {
      method,
      headers: withAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(flags),
    });
    const result = (await response.json()) as ProviderAccountPoolInfo & { error?: string };
    if (!response.ok || !result.id) {
      exitWithError([`Failed to save account pool: ${result.error || "Unknown error"}`]);
    }
    console.log(`Saved account pool: ${result.name} (${result.id})`);
  };

  const poolCreate = async (flags: ProviderPoolFlags): Promise<void> => {
    await savePool("POST", "/api/provider-account-pools", flags);
  };

  const poolUpdate = async (id: string, flags: ProviderPoolFlags): Promise<void> => {
    if (!id) exitWithError(["Usage: cybara provider pool update <pool-id> [options]"]);
    await savePool("PUT", `/api/provider-account-pools/${encodeURIComponent(id)}`, flags);
  };

  const poolDelete = async (id: string): Promise<void> => {
    if (!id) exitWithError(["Usage: cybara provider pool delete <pool-id>"]);
    const response = await fetch(
      `${apiBase}/api/provider-account-pools/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: withAuthHeaders() }
    );
    const result = (await response.json()) as { success?: boolean; error?: string };
    if (!response.ok || !result.success) {
      exitWithError([`Failed to delete account pool: ${result.error || "Unknown error"}`]);
    }
    console.log(`Deleted account pool: ${id}`);
  };

  return {
    add,
    available,
    delete: remove,
    discover,
    list,
    models,
    parseFlags,
    parsePoolFlags,
    poolCreate,
    poolDelete,
    poolList,
    poolUpdate,
    update,
  };
}
