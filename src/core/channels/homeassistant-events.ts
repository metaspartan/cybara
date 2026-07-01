export interface HomeAssistantInbound {
  text: string;
  senderId: string;
  conversationId: string;
}

export function parseHomeAssistantWebhook(body: unknown, query: Record<string, string>): HomeAssistantInbound | null {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = b[k] ?? query[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const text = pick("text", "message", "query", "command");
  if (!text) return null;
  return {
    text,
    senderId: pick("user", "user_id", "device_id") || "homeassistant",
    conversationId: pick("conversation_id", "conversation", "context") || "homeassistant",
  };
}

export function notifyTarget(service: string): { domain: string; service: string } {
  const trimmed = (service || "").trim();
  if (trimmed.includes(".")) {
    const [domain, ...rest] = trimmed.split(".");
    return { domain: domain || "notify", service: rest.join(".") || "notify" };
  }
  return { domain: "notify", service: trimmed || "notify" };
}
