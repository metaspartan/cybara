import type { GatewayProfile } from "./connection";

export interface HealthResponse {
  status: string;
  version?: string;
  uptime: number;
  timestamp: string;
  checks?: Record<string, { status: string; total?: number; running?: number; stopped?: number }>;
}

export interface SessionSummary {
  id: string;
  title: string | null;
  agent_id?: string;
  message_count: number;
  updated_at: string;
  workspace_dir?: string | null;
  last_message?: { role: string; content: string } | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  type?: string;
  status?: string;
  model?: string;
}

export interface ProviderSummary {
  id: string;
  name: string;
  provider: string;
  is_default?: boolean;
}

export interface FeatureSummary {
  health: HealthResponse | null;
  sessions: SessionSummary[];
  agents: AgentSummary[];
  providers: ProviderSummary[];
  channels: unknown[];
  tasks: unknown[];
  tools: unknown[];
  approvals: unknown[];
  walletStatus: unknown | null;
  walletPolicy: unknown | null;
  memory: unknown[];
  logs: unknown[];
  config: Record<string, unknown>;
}

export class CybaraMobileApi {
  private profile: GatewayProfile;

  constructor(profile: GatewayProfile) {
    this.profile = profile;
  }

  private headers(): Headers {
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${this.profile.apiKey}`);
    return headers;
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.profile.baseUrl}${path}`, {
      ...init,
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`Cybara API ${response.status} for ${path}`);
    }
    return (await response.json()) as T;
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/api/health");
  }

  sessions(): Promise<SessionSummary[]> {
    return this.request<SessionSummary[]>("/api/sessions?limit=50");
  }

  agents(): Promise<AgentSummary[]> {
    return this.request<AgentSummary[]>("/api/agents");
  }

  providers(): Promise<ProviderSummary[]> {
    return this.request<ProviderSummary[]>("/api/providers");
  }

  config(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/config");
  }

  updateConfig(data: Record<string, unknown>): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("/api/config", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async featureSummary(): Promise<FeatureSummary> {
    const safe = async <T>(fallback: T, task: () => Promise<T>): Promise<T> => {
      try {
        return await task();
      } catch {
        return fallback;
      }
    };

    const [
      health,
      sessions,
      agents,
      providers,
      channels,
      tasks,
      tools,
      approvals,
      walletStatus,
      walletPolicy,
      memory,
      logs,
      config,
    ] = await Promise.all([
      safe<HealthResponse | null>(null, () => this.health()),
      safe<SessionSummary[]>([], () => this.sessions()),
      safe<AgentSummary[]>([], () => this.agents()),
      safe<ProviderSummary[]>([], () => this.providers()),
      safe<unknown[]>([], () => this.request<unknown[]>("/api/channels")),
      safe<unknown[]>([], () => this.request<unknown[]>("/api/tasks")),
      safe<unknown[]>([], () => this.request<unknown[]>("/api/tools")),
      safe<unknown[]>([], () =>
        this.request<{ pending?: unknown[] }>("/api/tools/approvals").then((value) => value.pending || [])
      ),
      safe<unknown | null>(null, () => this.request<unknown>("/api/wallet/status")),
      safe<unknown | null>(null, () => this.request<unknown>("/api/wallet/agent-policy")),
      safe<unknown[]>([], () => this.request<unknown[]>("/api/memory")),
      safe<unknown[]>([], () => this.request<unknown[]>("/api/logs/activity")),
      safe<Record<string, unknown>>({}, () => this.config()),
    ]);

    return {
      health,
      sessions,
      agents,
      providers,
      channels,
      tasks,
      tools,
      approvals,
      walletStatus,
      walletPolicy,
      memory,
      logs,
      config,
    };
  }
}
