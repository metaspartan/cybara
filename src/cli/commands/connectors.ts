import { getFlagValue, hasFlag } from "./args";
import { isAccountConnectorId } from "../../core/account-connectors/store";
import {
  ACCOUNT_CONNECTOR_IDS,
  type AccountConnectorId,
} from "../../core/account-connectors/types";
import { openUrlInBrowser } from "../../core/runtime/open-url";

const connectorIdHelp = ACCOUNT_CONNECTOR_IDS.join("|");

export interface ConnectorStatus {
  id: AccountConnectorId;
  label: string;
  services: string[];
  docsUrl: string;
  redirectUri: string;
  configured: boolean;
  connected: boolean;
  access: "read" | "read_write";
  account?: string;
}

interface OAuthStart {
  state: string;
  authUrl: string;
}

interface OAuthStatus {
  status: "pending" | "connected" | "error" | "not_found";
  error?: string;
}

export interface PluginStatus {
  id: string;
  name: string;
  version: string;
  source: "bundled" | "local" | "workspace";
  skillCount: number;
  enabled: boolean;
}

export interface MCPServiceStatus {
  id: string;
  name: string;
  status: string;
  toolCount: number;
  transport?: "stdio" | "http";
}

type FetchAPI = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

function connectorId(value: string | undefined): AccountConnectorId {
  if (isAccountConnectorId(value)) return value;
  throw new Error(`Account app must be one of: ${ACCOUNT_CONNECTOR_IDS.join(", ")}`);
}

function printConnectorHelp(): void {
  console.log("Plugin Account App Commands:");
  console.log("  cybara plugin apps");
  console.log(`  cybara plugin configure <${connectorIdHelp}> --client-id <id>`);
  console.log("    [--read|--write] [CYBARA_CONNECTOR_CLIENT_SECRET=...]");
  console.log(`  cybara plugin connect <${connectorIdHelp}>`);
  console.log(`  cybara plugin disconnect <${connectorIdHelp}>`);
  console.log(`  cybara plugin setup <${connectorIdHelp}>`);
}

async function waitForOAuth(fetchAPI: FetchAPI, state: string): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await Bun.sleep(1_000);
    const status = await fetchAPI<OAuthStatus>(
      `/api/connectors/oauth/status?state=${encodeURIComponent(state)}`
    );
    if (status?.status === "connected") return;
    if (status?.status === "error") throw new Error(status.error || "Authorization failed");
    if (status?.status === "not_found") throw new Error("Authorization expired");
  }
  throw new Error("Authorization timed out");
}

export async function runConnectorCommand(args: string[], fetchAPI: FetchAPI): Promise<void> {
  const subcommand = args[0] || "list";
  if (subcommand === "list") {
    const connectors = await fetchAPI<ConnectorStatus[]>("/api/connectors");
    if (!connectors) return;
    for (const connector of connectors) {
      const state = connector.connected
        ? `connected${connector.account ? ` as ${connector.account}` : ""}`
        : connector.configured
          ? "configured"
          : "not configured";
      console.log(
        `${connector.label}: ${state} | ${connector.access === "read_write" ? "read/write" : "read-only"} | ${connector.services.join(", ")}`
      );
    }
    return;
  }

  const id = connectorId(args[1]);
  if (subcommand === "configure") {
    const clientId = getFlagValue(args, "--client-id");
    if (!clientId) throw new Error("--client-id is required");
    const result = await fetchAPI<ConnectorStatus>(`/api/connectors/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        clientId,
        ...(process.env.CYBARA_CONNECTOR_CLIENT_SECRET
          ? { clientSecret: process.env.CYBARA_CONNECTOR_CLIENT_SECRET }
          : {}),
        access: hasFlag(args, "--write") ? "read_write" : "read",
      }),
    });
    if (result) console.log(`${result.label} configured (${result.redirectUri})`);
    return;
  }
  if (subcommand === "connect") {
    const started = await fetchAPI<OAuthStart>(`/api/connectors/${id}/oauth/start`, {
      method: "POST",
    });
    if (!started) return;
    await openUrlInBrowser(started.authUrl);
    console.log("Complete authorization in the browser...");
    await waitForOAuth(fetchAPI, started.state);
    console.log("Account connected.");
    return;
  }
  if (subcommand === "disconnect") {
    const result = await fetchAPI<ConnectorStatus>(`/api/connectors/${id}`, {
      method: "DELETE",
    });
    if (result) console.log(`${result.label} disconnected.`);
    return;
  }
  if (subcommand === "setup") {
    const connectors = await fetchAPI<ConnectorStatus[]>("/api/connectors");
    const connector = connectors?.find((item) => item.id === id);
    if (connector) await openUrlInBrowser(connector.docsUrl);
    return;
  }
  printConnectorHelp();
}
