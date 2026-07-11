import db from "./database";

export interface SessionSearchHit {
  sessionId: string;
  sessionTitle: string | null;
  messageId: string;
  agentId: string | null;
  channelType: string | null;
  role: string;
  snippet: string;
  createdAt: string;
  rank: number;
}

export interface SessionSearchOptions {
  limit?: number;
  offset?: number;
  sessionId?: string;
  agentId?: string;
  role?: string;
}

let initialized = false;

export function ensureSessionSearchIndex(): void {
  if (initialized) return;
  const exists = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='session_messages_fts'")
    .get();
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
      content,
      content='session_messages',
      content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS session_messages_fts_ai AFTER INSERT ON session_messages BEGIN
      INSERT INTO session_messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS session_messages_fts_ad AFTER DELETE ON session_messages BEGIN
      INSERT INTO session_messages_fts(session_messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS session_messages_fts_au AFTER UPDATE OF content ON session_messages BEGIN
      INSERT INTO session_messages_fts(session_messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO session_messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);
  if (!exists) {
    db.exec("INSERT INTO session_messages_fts(session_messages_fts) VALUES ('rebuild')");
  }
  initialized = true;
}

export function toFtsQuery(input: string): string {
  const terms = input
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean)
    .slice(0, 12);
  if (terms.length === 0) return "";
  return terms.map((term) => `"${term}"*`).join(" AND ");
}

export function searchSessionMessages(
  query: string,
  options: SessionSearchOptions = {}
): SessionSearchHit[] {
  ensureSessionSearchIndex();
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) return [];
  const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
  const offset = Math.max(0, options.offset ?? 0);

  const filters: string[] = [];
  const params: (string | number)[] = [ftsQuery];
  if (options.sessionId) {
    filters.push("m.session_id = ?");
    params.push(options.sessionId);
  }
  if (options.agentId) {
    filters.push("m.agent_id = ?");
    params.push(options.agentId);
  }
  if (options.role) {
    filters.push("m.role = ?");
    params.push(options.role);
  }
  const where = filters.length ? `AND ${filters.join(" AND ")}` : "";
  params.push(limit, offset);

  const rows = db
    .query(
      `SELECT
         m.id AS messageId,
         m.session_id AS sessionId,
         m.agent_id AS agentId,
         m.channel_type AS channelType,
         m.role AS role,
         m.created_at AS createdAt,
         snippet(session_messages_fts, 0, '[', ']', '…', 18) AS snip,
         bm25(session_messages_fts) AS rank,
         s.title AS sessionTitle
       FROM session_messages_fts f
       JOIN session_messages m ON m.rowid = f.rowid
       LEFT JOIN chat_sessions s ON s.id = m.session_id
       WHERE session_messages_fts MATCH ? ${where}
       ORDER BY rank
       LIMIT ? OFFSET ?`
    )
    .all(...params) as Array<{
    messageId: string;
    sessionId: string;
    agentId: string | null;
    channelType: string | null;
    role: string;
    createdAt: string;
    snip: string;
    rank: number;
    sessionTitle: string | null;
  }>;

  return rows.map((row) => ({
    sessionId: row.sessionId,
    sessionTitle: row.sessionTitle,
    messageId: row.messageId,
    agentId: row.agentId,
    channelType: row.channelType,
    role: row.role,
    snippet: row.snip,
    createdAt: row.createdAt,
    rank: row.rank,
  }));
}
