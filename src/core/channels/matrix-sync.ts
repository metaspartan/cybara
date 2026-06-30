export interface MatrixInboundMessage {
  roomId: string;
  sender: string;
  body: string;
  eventId: string;
}

interface MatrixSyncResponse {
  next_batch?: string;
  rooms?: {
    join?: Record<
      string,
      {
        timeline?: {
          events?: Array<{
            type?: string;
            sender?: string;
            event_id?: string;
            content?: { msgtype?: string; body?: string };
            unsigned?: { age?: number };
          }>;
        };
      }
    >;
  };
}

export function parseSyncMessages(
  sync: unknown,
  selfUserId: string,
  options: { ignoreInitial?: boolean } = {}
): { nextBatch: string | null; messages: MatrixInboundMessage[] } {
  const data = (sync || {}) as MatrixSyncResponse;
  const nextBatch = typeof data.next_batch === "string" ? data.next_batch : null;
  const messages: MatrixInboundMessage[] = [];

  if (options.ignoreInitial) {
    return { nextBatch, messages };
  }

  const join = data.rooms?.join || {};
  for (const [roomId, room] of Object.entries(join)) {
    const events = room.timeline?.events || [];
    for (const event of events) {
      if (event.type !== "m.room.message") continue;
      const sender = event.sender || "";
      if (!sender || sender === selfUserId) continue;
      const content = event.content || {};
      if (content.msgtype !== "m.text") continue;
      const body = typeof content.body === "string" ? content.body.trim() : "";
      if (!body) continue;
      messages.push({ roomId, sender, body, eventId: event.event_id || "" });
    }
  }

  return { nextBatch, messages };
}

export function buildLoginBody(user: string, password: string): Record<string, unknown> {
  return {
    type: "m.login.password",
    identifier: { type: "m.id.user", user },
    password,
  };
}

export function sendEventPath(roomId: string, txnId: string): string {
  return `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`;
}

export function normalizeHomeserverUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}
