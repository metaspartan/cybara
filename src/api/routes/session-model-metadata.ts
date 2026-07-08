import { agentManager } from "../../core/agent";
import { providerManager } from "../../core/providers";
import { normalizeOptionalString, parseJsonObject, type SessionMessageView } from "./_shared";

export interface SessionModelMetadata {
  provider?: string;
  provider_id?: string;
  provider_name?: string;
  model?: string;
  agent_id?: string;
  agent_name?: string;
  agent_type?: string;
}

export function metadataFromRecord(
  record?: Record<string, unknown> | null
): SessionModelMetadata | null {
  if (!record) return null;
  const metadata: SessionModelMetadata = {
    provider:
      normalizeOptionalString(record.provider) || normalizeOptionalString(record.providerType),
    provider_id:
      normalizeOptionalString(record.provider_id) || normalizeOptionalString(record.providerId),
    provider_name:
      normalizeOptionalString(record.provider_name) || normalizeOptionalString(record.providerName),
    model: normalizeOptionalString(record.model) || normalizeOptionalString(record.model_id),
    agent_id: normalizeOptionalString(record.agent_id) || normalizeOptionalString(record.agentId),
    agent_name:
      normalizeOptionalString(record.agent_name) || normalizeOptionalString(record.agentName),
    agent_type:
      normalizeOptionalString(record.agent_type) || normalizeOptionalString(record.agentType),
  };
  const compact = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => typeof value === "string" && value.trim())
  ) as SessionModelMetadata;
  return Object.keys(compact).length > 0 ? compact : null;
}

export function mergeSessionModelMetadata(
  primary?: SessionModelMetadata | null,
  fallback?: SessionModelMetadata | null
): SessionModelMetadata {
  const merged: SessionModelMetadata = { ...(fallback ?? {}) };
  for (const [key, value] of Object.entries(primary ?? {}) as Array<
    [keyof SessionModelMetadata, string | undefined]
  >) {
    const normalized = normalizeOptionalString(value);
    if (normalized) merged[key] = normalized;
  }
  return merged;
}

export function latestSessionModelMetadata(
  messages: SessionMessageView[]
): SessionModelMetadata | null {
  for (const message of [...messages].reverse()) {
    const metadata = metadataFromRecord(message as unknown as Record<string, unknown>);
    if (metadata?.model || metadata?.provider || metadata?.provider_id) return metadata;
  }
  return null;
}

export function sessionModelMetadata(
  agentId?: string | null,
  fallback?: SessionModelMetadata | null
): SessionModelMetadata {
  if (!agentId) return fallback ?? {};
  const agent = agentManager.get(agentId);
  if (!agent) return fallback ?? {};
  const providerId = agent.provider_id || agent.provider;
  const provider = providerId ? providerManager.get(providerId) : undefined;
  return mergeSessionModelMetadata(
    {
      agent_id: agent.id,
      agent_name: agent.name,
      agent_type: agent.type,
      provider: provider?.provider || providerId,
      provider_id: providerId,
      provider_name: provider?.name,
      model: agent.model,
    },
    fallback
  );
}

export function sessionModelMetadataSnapshot(value: unknown): SessionModelMetadata | null {
  return metadataFromRecord(parseJsonObject(value));
}
