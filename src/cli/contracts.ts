export interface TaskItem {
  id: string;
  name: string;
  status: string;
  schedule?: string;
  lastRun?: string;
  session_id?: string;
}

export interface SkillItem {
  name: string;
  description: string;
  eligible: boolean;
  source: string;
}

export interface AgentItem {
  id: string;
  name: string;
  type: string;
  status: string;
  model?: string;
}

export interface SessionInfo {
  id: string;
  agent_id?: string;
  agentId?: string;
  title?: string;
  message_count?: number;
  messageCount?: number;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  workspaceDir?: string | null;
  modelMetadata?: {
    agent_name?: string;
    model?: string;
    provider?: string;
  } | null;
}

export interface LogEntry {
  timestamp?: string;
  created_at?: string;
  level?: string;
  module?: string;
  source?: string;
  logType?: string;
  message?: string;
}

export function sessionMessageCount(session: SessionInfo): number {
  return session.message_count ?? session.messageCount ?? 0;
}

export function sessionUpdatedAt(session: SessionInfo): string | undefined {
  return session.updated_at ?? session.updatedAt ?? session.created_at ?? session.createdAt;
}

export function sessionAgentLabel(
  session: SessionInfo,
  agentsById = new Map<string, AgentItem>()
): string {
  const metadata = session.modelMetadata;
  const metadataModel = [metadata?.agent_name, metadata?.model].filter(Boolean).join(" · ");
  if (metadataModel) return metadataModel;
  const agentId = session.agent_id || session.agentId;
  const agent = agentId ? agentsById.get(agentId) : undefined;
  if (agent?.name && agent.model) return `${agent.name} · ${agent.model}`;
  if (agent?.name) return agent.name;
  if (agent?.model) return agent.model;
  return "-";
}
