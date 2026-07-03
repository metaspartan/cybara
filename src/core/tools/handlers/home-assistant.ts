interface HaConfig {
  baseUrl: string;
  token: string;
}

export function resolveHaConfig(env: Record<string, string | undefined>): HaConfig | null {
  const baseUrl = (env.HOME_ASSISTANT_URL || env.HASS_URL || env.HA_URL || "").trim();
  const token = (env.HOME_ASSISTANT_TOKEN || env.HASS_TOKEN || env.HA_TOKEN || "").trim();
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

export function haHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export function haServiceUrl(baseUrl: string, domain: string, service: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`;
}

export function haStatesUrl(baseUrl: string, entityId?: string): string {
  const base = `${baseUrl.replace(/\/+$/, "")}/api/states`;
  return entityId ? `${base}/${encodeURIComponent(entityId)}` : base;
}

export function parseServiceTarget(action: string): { domain: string; service: string } | null {
  const trimmed = (action || "").trim();
  const match = /^([a-z0-9_]+)\.([a-z0-9_]+)$/.exec(trimmed);
  if (!match) return null;
  return { domain: match[1], service: match[2] };
}

interface HaState {
  entity_id?: string;
  state?: string;
  attributes?: { friendly_name?: string };
}

export function summarizeStates(states: unknown, filter?: string): Array<Record<string, string>> {
  if (!Array.isArray(states)) return [];
  const needle = filter?.trim().toLowerCase();
  const rows: Array<Record<string, string>> = [];
  for (const raw of states as HaState[]) {
    const id = raw?.entity_id || "";
    if (!id) continue;
    if (needle && !id.toLowerCase().includes(needle)) continue;
    rows.push({
      entity_id: id,
      state: typeof raw.state === "string" ? raw.state : "",
      name: raw.attributes?.friendly_name || id,
    });
  }
  return rows;
}

export async function handleHomeAssistant(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cfg = resolveHaConfig(process.env);
  if (!cfg) {
    return {
      error:
        "Home Assistant is not configured. Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN (a long-lived access token).",
    };
  }

  const action = typeof args.action === "string" ? args.action.trim() : "list_states";

  try {
    if (action === "list_states") {
      const res = await fetch(haStatesUrl(cfg.baseUrl), { headers: haHeaders(cfg.token) });
      if (!res.ok) return { error: `Home Assistant error: ${res.status}` };
      const filter = typeof args.filter === "string" ? args.filter : undefined;
      const entities = summarizeStates(await res.json(), filter);
      return { count: entities.length, entities: entities.slice(0, 200) };
    }

    if (action === "get_state") {
      const entityId = typeof args.entity_id === "string" ? args.entity_id.trim() : "";
      if (!entityId) return { error: "get_state requires entity_id" };
      const res = await fetch(haStatesUrl(cfg.baseUrl, entityId), {
        headers: haHeaders(cfg.token),
      });
      if (!res.ok) return { error: `Home Assistant error: ${res.status}` };
      return { state: await res.json() };
    }

    if (action === "call_service") {
      const service = typeof args.service === "string" ? args.service.trim() : "";
      const target = parseServiceTarget(service);
      if (!target) {
        return {
          error: "call_service requires 'service' as 'domain.service' (e.g. light.turn_on)",
        };
      }
      const data =
        args.data && typeof args.data === "object" ? (args.data as Record<string, unknown>) : {};
      const body: Record<string, unknown> = { ...data };
      if (typeof args.entity_id === "string" && args.entity_id.trim()) {
        body.entity_id = args.entity_id.trim();
      }
      const res = await fetch(haServiceUrl(cfg.baseUrl, target.domain, target.service), {
        method: "POST",
        headers: haHeaders(cfg.token),
        body: JSON.stringify(body),
      });
      if (!res.ok) return { error: `Home Assistant error: ${res.status}` };
      return { success: true, result: await res.json() };
    }

    return { error: `Unknown action: ${action}. Use list_states, get_state, or call_service.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Home Assistant request failed" };
  }
}
