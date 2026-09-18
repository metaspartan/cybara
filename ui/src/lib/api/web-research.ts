import { fetchApi } from "@/lib/api-client";

export type WebResearchCredentialId = "firecrawl" | "parallel" | "tavily" | "exa" | "brave";
export type WebResearchUrlId = "firecrawl" | "parallel" | "tavily" | "exa" | "brave" | "searxng";
export type WebSearchBackendId =
  | "firecrawl"
  | "parallel"
  | "tavily"
  | "exa"
  | "brave"
  | "mcp"
  | "searxng"
  | "duckduckgo";
export type WebResearchSettingSource = "env" | "stored" | "none";

export interface WebSearchBackendStatus {
  id: WebSearchBackendId;
  label: string;
  configured: boolean;
  enabled: boolean;
}

export interface WebSearchMcpBackend {
  server: string;
  tool: string;
  queryArg: string;
  countArg: string;
}

export interface WebSearchMcpServerOption {
  id: string;
  name: string;
  running: boolean;
  tools: string[];
}

export interface WebResearchSettingsStatus {
  credentials: Array<{
    id: WebResearchCredentialId;
    label: string;
    envVar: string;
    configured: boolean;
    source: WebResearchSettingSource;
  }>;
  urls: Array<{
    id: WebResearchUrlId;
    label: string;
    value: string;
    placeholder: string;
    source: WebResearchSettingSource;
    envVar: string;
  }>;
  backends: WebSearchBackendStatus[];
  backendOrderSource: WebResearchSettingSource;
  disabledBackendsSource: WebResearchSettingSource;
  mcpBackend: WebSearchMcpBackend & { source: WebResearchSettingSource };
  mcpServers: WebSearchMcpServerOption[];
}

export interface WebResearchSettingsUpdate {
  credentials?: Partial<Record<WebResearchCredentialId, string | null>>;
  urls?: Partial<Record<WebResearchUrlId, string | null>>;
  backendOrder?: WebSearchBackendId[] | null;
  disabledBackends?: WebSearchBackendId[] | null;
  mcpBackend?: WebSearchMcpBackend | null;
}

export const webResearchApi = {
  settings: () => fetchApi<WebResearchSettingsStatus>("/web-research/settings"),
  updateSettings: (data: WebResearchSettingsUpdate) =>
    fetchApi<WebResearchSettingsStatus>("/web-research/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};
