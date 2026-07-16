import { CLI_API_BASE as API_BASE, fetchCliAPI as fetchAPI, withCliAuthHeaders } from "../client";
import { openUrlInBrowser } from "../../core/runtime/open-url";

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

export async function rawMcpSearch(query: string): Promise<void> {
  const data = await fetchAPI<MCPRegistryServer[]>(
    `/api/mcp/registry/search?q=${encodeURIComponent(query)}`
  );
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

export async function rawMcpInstall(pkg: string): Promise<void> {
  console.log(`Installing MCP server: ${pkg}...`);

  const data = await fetchAPI<{
    success: boolean;
    id?: string;
    error?: string;
  }>("/api/mcp/registry/install", {
    method: "POST",
    body: JSON.stringify({ package: pkg, trustedAction: true }),
  });

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

export async function rawMcpAdd(name: string, url: string): Promise<void> {
  const created = await fetchAPI<{ id: string; name: string; url?: string }>("/api/mcp", {
    method: "POST",
    body: JSON.stringify({ name, url, enabled: true }),
  });
  if (!created?.id) {
    console.error("ERROR: Failed to add remote MCP server");
    process.exit(1);
  }
  const started = await fetchAPI<{ success: boolean; error?: string }>(
    `/api/mcp/${encodeURIComponent(created.id)}/start`,
    { method: "POST" }
  );
  console.log(`Added remote MCP server: ${created.name}`);
  console.log(`  id: ${created.id}`);
  console.log(`  url: ${created.url || url}`);
  if (started?.success) {
    console.log("  status: connected");
    return;
  }
  const error = started?.error || "not connected";
  if (!/\b401\b|unauthori[sz]ed|authentication required/i.test(error)) {
    console.log(`  status: saved (${error})`);
    return;
  }
  const authorization = await fetchAPI<{
    success: boolean;
    authUrl?: string;
    state?: string;
    error?: string;
  }>(`/api/mcp/${encodeURIComponent(created.id)}/oauth/start`, {
    method: "POST",
  });
  if (!authorization?.success || !authorization.authUrl || !authorization.state) {
    console.log(`  status: saved (${authorization?.error || "authorization unavailable"})`);
    return;
  }
  console.log("  status: authorization required");
  console.log(`  authorize: ${authorization.authUrl}`);
  try {
    await openUrlInBrowser(authorization.authUrl);
  } catch {}
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await Bun.sleep(1000);
    const status = await fetchAPI<{
      status: "pending" | "connected" | "error" | "not_found";
      error?: string;
    }>(`/api/mcp/oauth/status?state=${encodeURIComponent(authorization.state)}`);
    if (status?.status === "connected") {
      console.log("  status: connected");
      return;
    }
    if (status?.status === "error" || status?.status === "not_found") {
      console.log(`  status: saved (${status.error || "authorization failed"})`);
      return;
    }
  }
  console.log("  status: saved (authorization timed out)");
}

export async function rawMcpList(): Promise<void> {
  const data =
    await fetchAPI<
      Array<{
        id: string;
        name: string;
        command: string;
        status: string;
        toolCount: number;
      }>
    >("/api/mcp");
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

export async function rawMcpPopular(): Promise<void> {
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
  const channels = (await fetchAPI<ChannelInfo[]>("/api/channels")) || [];

  console.log("PENDING PAIRINGS");
  console.log("================");
  console.log("");

  let totalPending = 0;
  for (const channel of channels) {
    const data = await fetchAPI<{
      pairings: PairingInfo[];
      pendingCount: number;
    }>(`/api/channels/${channel.id}/pairings`);
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
  const channels = (await fetchAPI<ChannelInfo[]>("/api/channels")) || [];

  for (const channel of channels) {
    const result = await fetchAPI<{
      success: boolean;
      senderId?: string;
      error?: string;
    }>(`/api/channels/${channel.id}/pairings/verify`, {
      method: "POST",
      body: JSON.stringify({ code: code.toUpperCase() }),
    });

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
  const channels = (await fetchAPI<ChannelInfo[]>("/api/channels")) || [];

  for (const channel of channels) {
    const pairings = await fetchAPI<{ pairings: PairingInfo[] }>(
      `/api/channels/${channel.id}/pairings`
    );
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

  const channels = (await fetchAPI<ChannelInfo[]>("/api/channels")) || [];
  const channel = channels.find(
    (c) => c.name.toLowerCase() === channelName.toLowerCase() || c.id === channelName
  );

  if (!channel) {
    console.error(`Channel not found: ${channelName}`);
    console.log("Available channels:");
    for (const c of channels) {
      console.log(`  - ${c.name} (${c.type})`);
    }
    process.exit(1);
  }

  const result = await fetchAPI<{
    success: boolean;
    config: { dm_policy: string };
  }>(`/api/channels/${channel.id}/security`, {
    method: "PUT",
    body: JSON.stringify({ dm_policy: policy }),
  });

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

export async function rawLsp(): Promise<void> {
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

  const bundled = data.status.filter((l) => l.type === "bundled");
  const installable = data.status.filter((l) => l.type !== "bundled");

  console.log("");
  console.log("Bundled (included in binary):");
  for (const lang of bundled) {
    console.log(`  ✓ ${lang.displayName.padEnd(15)} ${lang.description}`);
  }

  console.log("");
  console.log("Installable:");
  for (const lang of installable) {
    const status = lang.installed
      ? "✓ installed"
      : lang.available
        ? "✓ in PATH"
        : "✗ not installed";
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
  console.log(
    "Available languages: " +
      data.status
        .filter((l) => l.type !== "bundled")
        .map((l) => l.language)
        .join(", ")
  );
}

export async function rawLspInstall(language: string): Promise<void> {
  if (!language) {
    console.error("ERROR: Please specify a language to install");
    console.log("Usage: cybara lsp install <language>");
    console.log("");

    const data = await fetchAPI<{
      status: { language: string; displayName: string; type: string }[];
    }>("/api/lsp/install-status");
    if (data) {
      const installable = data.status.filter((l) => l.type !== "bundled");
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
    headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ language }),
  });

  const result = (await response.json()) as {
    success: boolean;
    error?: string;
    path?: string;
  };

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

export async function rawLspUninstall(language: string): Promise<void> {
  if (!language) {
    console.error("ERROR: Please specify a language to uninstall");
    console.log("Usage: cybara lsp uninstall <language>");
    process.exit(1);
  }

  console.log(`Uninstalling ${language} language server...`);

  const response = await fetch(`${API_BASE}/api/lsp/uninstall`, {
    method: "POST",
    headers: withCliAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ language }),
  });

  const result = (await response.json()) as {
    success: boolean;
    error?: string;
  };

  if (result.success) {
    console.log(`✓ Successfully uninstalled ${language}`);
  } else {
    console.error(`✗ Failed to uninstall ${language}: ${result.error}`);
    process.exit(1);
  }
}

export async function rawPairCommand(args: string[]): Promise<void> {
  const pairSubCmd = args[0];
  if (!pairSubCmd || pairSubCmd === "list") {
    await rawPairList();
  } else if (pairSubCmd === "reject") {
    const rejectCode = args[1];
    if (!rejectCode) {
      console.error("Usage: cybara pair reject <CODE>");
      process.exit(1);
    }
    await rawPairReject(rejectCode);
  } else if (pairSubCmd === "policy") {
    const channelName = args[1];
    const policy = args[2];
    if (!channelName || !policy) {
      console.error("Usage: cybara pair policy <channel> <policy>");
      console.log("Policies: pairing, allowlist, open, disabled");
      process.exit(1);
    }
    await rawPairPolicy(channelName, policy);
  } else {
    await rawPairApprove(pairSubCmd);
  }
}
