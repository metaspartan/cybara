import db from "../core/database";
import type { PendingChatItem } from "./chat-runtime-state";
import type { ChatRequest } from "./chat-types";

interface PendingChatRow {
  id: string;
  session_id: string;
  client_pending_id: string | null;
  request_json: string;
  content: string;
  created_at: number;
  updated_at: number;
  mode: string;
  sequence: number;
  materialized: number;
}

const upsertStatement = db.prepare(`
  INSERT INTO pending_chat_messages (
    id, session_id, client_pending_id, request_json, content,
    created_at, updated_at, mode, sequence, materialized
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    session_id = excluded.session_id,
    client_pending_id = excluded.client_pending_id,
    request_json = excluded.request_json,
    content = excluded.content,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    mode = excluded.mode,
    sequence = excluded.sequence,
    materialized = excluded.materialized
`);
const deleteStatement = db.prepare("DELETE FROM pending_chat_messages WHERE id = ?");
const listStatement = db.prepare(
  "SELECT * FROM pending_chat_messages ORDER BY session_id, sequence, created_at"
);
const listSessionStatement = db.prepare(
  "SELECT * FROM pending_chat_messages WHERE session_id = ? ORDER BY sequence, created_at"
);

function parseRequest(value: string): ChatRequest | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const request = parsed as Record<string, unknown>;
    if (typeof request.message !== "string" || request.message.trim().length === 0) return null;
    return request as unknown as ChatRequest;
  } catch {
    return null;
  }
}

function fromRow(row: PendingChatRow): PendingChatItem | null {
  const request = parseRequest(row.request_json);
  const mode = row.mode === "steering" ? "steering" : row.mode === "queued" ? "queued" : null;
  if (!request || !mode || !row.id || !row.session_id || !row.content.trim()) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    ...(row.client_pending_id ? { clientPendingId: row.client_pending_id } : {}),
    request,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mode,
    sequence: row.sequence,
    ...(row.materialized === 1 ? { materialized: true } : {}),
  };
}

export function persistPendingChatItem(item: PendingChatItem): void {
  upsertStatement.run(
    item.id,
    item.sessionId,
    item.clientPendingId ?? null,
    JSON.stringify(item.request),
    item.content,
    item.createdAt,
    item.updatedAt,
    item.mode,
    item.sequence,
    item.materialized === true ? 1 : 0
  );
}

export function persistPendingChatItems(items: PendingChatItem[]): void {
  db.transaction((pendingItems: PendingChatItem[]) => {
    for (const item of pendingItems) persistPendingChatItem(item);
  })(items);
}

export function deletePersistedPendingChatItem(id: string): void {
  deleteStatement.run(id);
}

export function loadPersistedPendingChatItems(sessionId?: string): PendingChatItem[] {
  const rows = (
    sessionId ? listSessionStatement.all(sessionId) : listStatement.all()
  ) as PendingChatRow[];
  return rows.map(fromRow).filter((item): item is PendingChatItem => item !== null);
}
