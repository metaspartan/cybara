import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync, existsSync, chmodSync } from "fs";
import { dataDir } from "./paths";

const dbPath = join(dataDir, "platform.db");

console.log("[Database] Initializing at:", dbPath);

if (!existsSync(dataDir)) {
  console.log("[Database] Creating data directory");
  mkdirSync(dataDir, { recursive: true });
}

// The DB holds provider API keys/tokens (and the encrypted wallet). Restrict it
// to the owner so other local users / backups can't read credentials at rest.
// Best-effort: no-op on platforms without POSIX permissions.
function restrictPermissions(): void {
  try {
    chmodSync(dataDir, 0o700);
    for (const suffix of ["", "-wal", "-shm"]) {
      const p = `${dbPath}${suffix}`;
      if (existsSync(p)) chmodSync(p, 0o600);
    }
  } catch {
    /* best-effort */
  }
}
restrictPermissions();

const db = new Database(dbPath);
console.log("[Database] Database instance created");
restrictPermissions();
db.exec("PRAGMA journal_mode = WAL");
// NORMAL is safe under WAL and much faster than FULL for our write-heavy
// telemetry; busy_timeout avoids "database is locked" under concurrent access.
db.exec("PRAGMA synchronous = NORMAL");
db.exec("PRAGMA busy_timeout = 5000");
console.log("[Database] Journal mode set");

console.log("[Database] Creating schema...");
try {
  db.exec(`
  -- Platform configuration
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- AI Providers with credentials
  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT,
    api_key TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at INTEGER,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Provider models cache
  CREATE TABLE IF NOT EXISTS provider_models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_name TEXT,
    context_window INTEGER,
    max_tokens INTEGER,
    reasoning BOOLEAN,
    input_types TEXT,
    cost_input REAL,
    cost_output REAL,
    cost_cache_read REAL,
    cost_cache_write REAL,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  );

  -- MCP Servers
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    args TEXT,
    env TEXT,
    url TEXT,
    enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Agents
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'main',
    model TEXT,
    provider_id TEXT,
    system_prompt TEXT,
    tools TEXT,
    config TEXT,
    status TEXT DEFAULT 'stopped',
    memory_enabled BOOLEAN DEFAULT 0,
    fallback_provider_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Messaging Channels
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Scheduled Tasks
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'scheduled',
    schedule TEXT,
    config TEXT,
    status TEXT DEFAULT 'pending',
    last_run DATETIME,
    next_run DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Task Run History
  CREATE TABLE IF NOT EXISTS task_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    session_id TEXT,
    result_preview TEXT,
    error TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  -- Sessions/Conversations
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    channel_type TEXT,
    channel_id TEXT,
    title TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  -- Setup wizard state
  CREATE TABLE IF NOT EXISTS setup_state (
    step TEXT PRIMARY KEY,
    completed INTEGER DEFAULT 0,
    config TEXT
  );

  -- Chat sessions (conversations)
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    title TEXT,
    messages TEXT NOT NULL,
    workspace_dir TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Chat memory (TOON format - Tools, Objects, Operators, Narratives)
  CREATE TABLE IF NOT EXISTS chat_memory (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
  );

  -- Session messages (all messages sent/received)
  CREATE TABLE IF NOT EXISTS session_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_id TEXT,
    channel_type TEXT,
    channel_id TEXT,
    role TEXT NOT NULL, -- 'user', 'assistant', 'system', 'tool'
    content TEXT NOT NULL,
    metadata TEXT, -- JSON: tool_calls, thinking, etc.
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
  );

  -- System logs
  CREATE TABLE IF NOT EXISTS system_logs (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL, -- 'debug', 'info', 'warn', 'error'
    source TEXT NOT NULL, -- 'agent', 'channel', 'tool', 'system'
    message TEXT NOT NULL,
    metadata TEXT, -- JSON: additional context
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Agent activity logs
  CREATE TABLE IF NOT EXISTS agent_logs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    action TEXT NOT NULL, -- 'spawned', 'message', 'tool_call', 'error', 'completed'
    details TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Metrics and statistics tracking
  CREATE TABLE IF NOT EXISTS metrics (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL, -- 'token_usage', 'file_operation', 'api_call', 'tool_call', 'agent_execution'
    key TEXT NOT NULL, -- e.g., 'gpt-4', 'read', 'read', 'claude-3-opus'
    value INTEGER NOT NULL, -- Numeric value (tokens, file count, etc.)
    metadata TEXT, -- JSON: additional context like model, provider, file path, etc.
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Daily aggregates for fast querying
  CREATE TABLE IF NOT EXISTS metrics_daily (
    id TEXT PRIMARY KEY,
    date DATE NOT NULL,
    type TEXT NOT NULL,
    key TEXT NOT NULL,
    value INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(date, type, key)
  );

  -- Channel message logs
  CREATE TABLE IF NOT EXISTS channel_logs (
    id TEXT PRIMARY KEY,
    channel_type TEXT NOT NULL,
    channel_id TEXT,
    direction TEXT NOT NULL, -- 'incoming', 'outgoing'
    sender_id TEXT,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Allowed senders for channel security (persisted pairings)
  CREATE TABLE IF NOT EXISTS allowed_senders (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    platform TEXT,
    sender_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, sender_id)
  );

  -- Create indexes for performance
  CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_session_messages_session_created ON session_messages(session_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_session_messages_created ON session_messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
  CREATE INDEX IF NOT EXISTS idx_system_logs_source ON system_logs(source);
  CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_logs_agent ON agent_logs(agent_id);
  CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_channel_logs_type ON channel_logs(channel_type);
  CREATE INDEX IF NOT EXISTS idx_channel_logs_created ON channel_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_allowed_senders_channel ON allowed_senders(channel_id);
  -- metrics is the largest, hottest table (telemetry); every /api/metrics query
  -- filters by type/key and orders by created_at. Without these it was a full
  -- multi-million-row scan per query (the slow Metrics page).
  CREATE INDEX IF NOT EXISTS idx_metrics_type_key ON metrics(type, key);
  CREATE INDEX IF NOT EXISTS idx_metrics_type_key_value ON metrics(type, key, value);
  CREATE INDEX IF NOT EXISTS idx_metrics_type_created ON metrics(type, created_at);
  CREATE INDEX IF NOT EXISTS idx_metrics_created ON metrics(created_at);
  CREATE INDEX IF NOT EXISTS idx_metrics_daily_date ON metrics_daily(date);
`);
  console.log("[Database] Schema created successfully");

  try {
    db.exec("ALTER TABLE agents ADD COLUMN fallback_provider_id TEXT");
    console.log("[Database] Migration: Added fallback_provider_id column");
  } catch {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN workspace_dir TEXT");
    console.log("[Database] Migration: Added workspace_dir column to chat_sessions");
  } catch {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN title TEXT");
    console.log("[Database] Migration: Added title column to chat_sessions");
  } catch {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE chat_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
    console.log("[Database] Migration: Added pinned column to chat_sessions");
  } catch {
    // Column already exists, ignore
  }

  try {
    db.exec("ALTER TABLE mcp_servers ADD COLUMN url TEXT");
    console.log("[Database] Migration: Added url column to mcp_servers");
  } catch {
    // Column already exists, ignore
  }

  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_chat_sessions_pinned_updated ON chat_sessions(pinned DESC, updated_at DESC)"
    );
  } catch (error) {
    console.error("[Database] Index creation error (pinned):", error);
  }
} catch (error) {
  console.error("[Database] Schema creation error:", error);
}

db.exec(`
  -- Platform configuration
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- AI Providers with credentials
  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT,
    api_key TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at INTEGER,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Provider models cache
  CREATE TABLE IF NOT EXISTS provider_models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_name TEXT,
    context_window INTEGER,
    max_tokens INTEGER,
    reasoning BOOLEAN,
    input_types TEXT,
    cost_input REAL,
    cost_output REAL,
    cost_cache_read REAL,
    cost_cache_write REAL,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  );

  -- MCP Servers
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    args TEXT,
    env TEXT,
    url TEXT,
    enabled BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Agents
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'main',
    model TEXT,
    provider_id TEXT,
    system_prompt TEXT,
    tools TEXT,
    config TEXT,
    status TEXT DEFAULT 'stopped',
    memory_enabled BOOLEAN DEFAULT 0,
    fallback_provider_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Messaging Channels
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Scheduled Tasks
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'scheduled',
    schedule TEXT,
    config TEXT,
    status TEXT DEFAULT 'pending',
    last_run DATETIME,
    next_run DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Sessions/Conversations
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    channel_type TEXT,
    channel_id TEXT,
    title TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  -- Setup wizard state
  CREATE TABLE IF NOT EXISTS setup_state (
    step TEXT PRIMARY KEY,
    completed INTEGER DEFAULT 0,
    config TEXT
  );

  -- Chat sessions (conversations)
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    title TEXT,
    messages TEXT NOT NULL,
    workspace_dir TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Chat memory (TOON format - Tools, Objects, Operators, Narratives)
  CREATE TABLE IF NOT EXISTS chat_memory (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
  );
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_agent ON chat_sessions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_chat_memory_session ON chat_memory(session_id);
`);

const prepare = (sql: string) => db.prepare(sql);

function serializeJsonColumn(value: unknown): string | null {
  if (value === undefined || value === null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      return JSON.stringify(trimmed);
    }
  }

  return JSON.stringify(value);
}

const stmts = {
  config: {
    get: prepare("SELECT value FROM config WHERE key = ?"),
    set: prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)"),
    all: prepare("SELECT key, value FROM config"),
  },
  providers: {
    all: prepare("SELECT * FROM providers ORDER BY created_at DESC"),
    get: prepare("SELECT * FROM providers WHERE id = ?"),
    create: prepare(
      "INSERT INTO providers (id, provider, name, base_url, api_key, access_token, refresh_token, expires_at, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ),
    update: prepare(
      "UPDATE providers SET name=?, base_url=?, api_key=?, access_token=?, refresh_token=?, expires_at=?, is_default=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ),
    delete: prepare("DELETE FROM providers WHERE id = ?"),
  },
  providerModels: {
    all: prepare("SELECT * FROM provider_models"),
    byProvider: prepare("SELECT * FROM provider_models WHERE provider_id = ?"),
    byModelId: prepare("SELECT * FROM provider_models WHERE model_id = ? LIMIT 1"),
    upsert: prepare(
      "INSERT OR REPLACE INTO provider_models (id, provider_id, model_id, model_name, context_window, max_tokens, reasoning, input_types, cost_input, cost_output, cost_cache_read, cost_cache_write) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ),
  },
  mcpServers: {
    all: prepare("SELECT * FROM mcp_servers ORDER BY created_at DESC"),
    get: prepare("SELECT * FROM mcp_servers WHERE id = ?"),
    create: prepare(
      "INSERT INTO mcp_servers (id, name, command, args, env, url, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ),
    update: prepare(
      "UPDATE mcp_servers SET name=?, command=?, args=?, env=?, url=COALESCE(?, url), enabled=? WHERE id=?"
    ),
    delete: prepare("DELETE FROM mcp_servers WHERE id = ?"),
  },
  agents: {
    all: prepare("SELECT * FROM agents ORDER BY created_at DESC"),
    get: prepare("SELECT * FROM agents WHERE id = ?"),
    create: prepare(
      "INSERT INTO agents (id, name, type, model, provider_id, system_prompt, tools, config, status, memory_enabled, fallback_provider_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ),
    update: prepare(
      "UPDATE agents SET name=?, type=?, model=?, provider_id=?, system_prompt=?, tools=?, config=?, status=?, memory_enabled=?, fallback_provider_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
    ),
    updateStatus: prepare("UPDATE agents SET status=? WHERE id=?"),
    delete: prepare("DELETE FROM agents WHERE id = ?"),
  },
  channels: {
    all: prepare("SELECT * FROM channels ORDER BY created_at DESC"),
    get: prepare("SELECT * FROM channels WHERE id = ?"),
    create: prepare(
      "INSERT INTO channels (id, type, name, config, enabled) VALUES (?, ?, ?, ?, ?)"
    ),
    update: prepare(
      "UPDATE channels SET name=COALESCE(?, name), config=COALESCE(?, config), enabled=COALESCE(?, enabled) WHERE id=?"
    ),
    delete: prepare("DELETE FROM channels WHERE id = ?"),
  },
  tasks: {
    all: prepare("SELECT * FROM tasks ORDER BY created_at DESC"),
    get: prepare("SELECT * FROM tasks WHERE id = ?"),
    create: prepare(
      "INSERT INTO tasks (id, agent_id, name, type, schedule, config, status, next_run) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ),
    update: prepare("UPDATE tasks SET status=?, last_run=?, next_run=? WHERE id=?"),
    replace: prepare(
      "UPDATE tasks SET agent_id=?, name=?, type=?, schedule=?, config=?, status=?, next_run=? WHERE id=?"
    ),
    delete: prepare("DELETE FROM tasks WHERE id = ?"),
  },
  taskRuns: {
    getByTask: prepare(
      "SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 10"
    ),
    create: prepare(
      "INSERT INTO task_runs (id, task_id, status, started_at, completed_at, session_id, result_preview, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ),
    updateComplete: prepare(
      "UPDATE task_runs SET status=?, completed_at=?, session_id=?, result_preview=?, error=? WHERE id=?"
    ),
    getRecent: prepare(
      "SELECT tr.*, t.name as task_name FROM task_runs tr JOIN tasks t ON tr.task_id = t.id ORDER BY tr.started_at DESC LIMIT 20"
    ),
  },
  setup: {
    getStep: prepare("SELECT * FROM setup_state WHERE step = ?"),
    setStep: prepare(
      "INSERT OR REPLACE INTO setup_state (step, completed, config) VALUES (?, ?, ?)"
    ),
    all: prepare("SELECT step, completed FROM setup_state"),
  },
  chatSessions: {
    get: prepare("SELECT * FROM chat_sessions WHERE id = ?"),
    upsert: prepare(
      "INSERT OR REPLACE INTO chat_sessions (id, agent_id, title, messages, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ),
    updateWorkspace: prepare(
      "UPDATE chat_sessions SET workspace_dir = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ),
    updateTitle: prepare(
      "UPDATE chat_sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ),
    getWorkspace: prepare("SELECT workspace_dir FROM chat_sessions WHERE id = ?"),
    getTitle: prepare("SELECT title FROM chat_sessions WHERE id = ?"),
    // Pin toggle deliberately does NOT bump updated_at — pinning is not chat activity.
    setPinned: prepare("UPDATE chat_sessions SET pinned = ? WHERE id = ?"),
    delete: prepare("DELETE FROM chat_sessions WHERE id = ?"),
    list: prepare("SELECT * FROM chat_sessions ORDER BY pinned DESC, updated_at DESC"),
  },
  chatMemory: {
    getBySession: prepare("SELECT * FROM chat_memory WHERE session_id = ? ORDER BY created_at ASC"),
    add: prepare(
      "INSERT INTO chat_memory (id, session_id, type, content, embedding) VALUES (?, ?, ?, ?, ?)"
    ),
    search: prepare(
      "SELECT * FROM chat_memory WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?"
    ),
  },
  sessionMessages: {
    getBySession: prepare(
      "SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC"
    ),
    add: prepare(
      "INSERT INTO session_messages (id, session_id, agent_id, channel_type, channel_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))"
    ),
    list: prepare("SELECT * FROM session_messages ORDER BY created_at DESC LIMIT 1000"),
    recentByRole: prepare(
      "SELECT role, substr(content, 1, 4000) as content FROM session_messages WHERE role = ? AND content != '' ORDER BY created_at DESC LIMIT ?"
    ),
    search: prepare(
      "SELECT * FROM session_messages WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?"
    ),
  },
  systemLogs: {
    add: prepare(
      "INSERT INTO system_logs (id, level, source, message, metadata) VALUES (?, ?, ?, ?, ?)"
    ),
    getByLevel: prepare(
      "SELECT * FROM system_logs WHERE level = ? ORDER BY created_at DESC LIMIT 1000"
    ),
    getBySource: prepare(
      "SELECT * FROM system_logs WHERE source = ? ORDER BY created_at DESC LIMIT 1000"
    ),
    list: prepare("SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 1000"),
    search: prepare(
      "SELECT * FROM system_logs WHERE message LIKE ? ORDER BY created_at DESC LIMIT ?"
    ),
  },
  agentLogs: {
    add: prepare(
      "INSERT INTO agent_logs (id, agent_id, action, details, metadata) VALUES (?, ?, ?, ?, ?)"
    ),
    getByAgent: prepare(
      "SELECT * FROM agent_logs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1000"
    ),
    list: prepare("SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT 1000"),
  },
  channelLogs: {
    add: prepare(
      "INSERT INTO channel_logs (id, channel_type, channel_id, direction, sender_id, content, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ),
    getByChannel: prepare(
      "SELECT * FROM channel_logs WHERE channel_type = ? AND channel_id = ? ORDER BY created_at DESC LIMIT 1000"
    ),
    list: prepare("SELECT * FROM channel_logs ORDER BY created_at DESC LIMIT 1000"),
  },
  metrics: {
    add: prepare("INSERT INTO metrics (id, type, key, value, metadata) VALUES (?, ?, ?, ?, ?)"),
    getByType: prepare("SELECT * FROM metrics WHERE type = ? ORDER BY created_at DESC"),
    getByTypeRecent: prepare(
      "SELECT * FROM metrics WHERE type = ? ORDER BY created_at DESC LIMIT ?"
    ),
    getTotal: prepare("SELECT SUM(value) as total FROM metrics WHERE type = ? AND key = ?"),
    getTotalByType: prepare("SELECT SUM(value) as total FROM metrics WHERE type = ?"),
    countByType: prepare("SELECT COUNT(*) as count FROM metrics WHERE type = ?"),
    countByTypeMetadataLike: prepare(
      "SELECT COUNT(*) as count FROM metrics WHERE type = ? AND metadata LIKE ?"
    ),
    countByTypeSince: prepare(
      "SELECT COUNT(*) as count FROM metrics WHERE type = ? AND created_at >= ?"
    ),
    countByTypeMetadataLikeSince: prepare(
      "SELECT COUNT(*) as count FROM metrics WHERE type = ? AND metadata LIKE ? AND created_at >= ?"
    ),
    getKeyTotalsWithLatestMetadata: prepare(
      "SELECT key, SUM(value) as total, metadata, MAX(created_at) as created_at FROM metrics WHERE type = ? GROUP BY key"
    ),
    getKeyAggregates: prepare(
      "SELECT key, SUM(value) as total, COUNT(*) as count FROM metrics WHERE type = ? GROUP BY key"
    ),
    getKeyTotalsSince: prepare(
      "SELECT key, SUM(value) as total FROM metrics WHERE type = ? AND created_at >= ? GROUP BY key"
    ),
    getTotalSince: prepare(
      "SELECT SUM(value) as total FROM metrics WHERE type = ? AND key = ? AND created_at >= ? AND created_at < ?"
    ),
    getLatestValue: prepare(
      "SELECT value FROM metrics WHERE type = ? AND key = ? ORDER BY created_at DESC LIMIT 1"
    ),
    getTopKeys: prepare(
      "SELECT key, SUM(value) as total FROM metrics WHERE type = ? GROUP BY key ORDER BY total DESC LIMIT 20"
    ),
    getByDate: prepare(
      "SELECT * FROM metrics WHERE type = ? AND date(created_at) = ? ORDER BY created_at DESC"
    ),
    getDailyTotalsFromRaw: prepare(
      "SELECT type, SUM(value) as total FROM metrics WHERE date(created_at) = ? GROUP BY type"
    ),
    getDailyTotalsFromRawRange: prepare(
      "SELECT date(created_at) as date, type, SUM(value) as total FROM metrics WHERE created_at >= ? AND created_at < ? GROUP BY date(created_at), type"
    ),
    addDaily: prepare(
      "INSERT OR REPLACE INTO metrics_daily (id, date, type, key, value) VALUES (?, ?, ?, ?, ?)"
    ),
    getDaily: prepare(
      "SELECT * FROM metrics_daily WHERE date = ? AND type = ? ORDER BY value DESC"
    ),
    getDailyTotals: prepare(
      "SELECT type, SUM(value) as total FROM metrics_daily WHERE date = ? GROUP BY type"
    ),
    getDailyTotalsRange: prepare(
      "SELECT date, type, SUM(value) as total FROM metrics_daily WHERE date >= ? AND date < ? GROUP BY date, type"
    ),
    deleteOlderThan: prepare(
      "DELETE FROM metrics WHERE created_at < datetime('now', '-' || ? || ' days')"
    ),
    count: prepare("SELECT COUNT(*) as count FROM metrics"),
  },
};

export const tables = {
  config: {
    get: (key: string): { value: string } | null =>
      stmts.config.get.get(key) as { value: string } | null,
    set: (key: string, value: string) => stmts.config.set.run(key, value),
    all: (): { key: string; value: string }[] =>
      stmts.config.all.all() as { key: string; value: string }[],
  },
  providers: {
    all: () => stmts.providers.all.all(),
    get: (id: string) => stmts.providers.get.get(id),
    create: (p: Provider) =>
      stmts.providers.create.run(
        p.id,
        p.provider,
        p.name,
        p.base_url || null,
        p.api_key || null,
        p.access_token || null,
        p.refresh_token || null,
        p.expires_at || null,
        p.is_default ? 1 : 0
      ),
    update: (id: string, p: Partial<Provider>) =>
      stmts.providers.update.run(
        p.name || null,
        p.base_url || null,
        p.api_key || null,
        p.access_token || null,
        p.refresh_token || null,
        p.expires_at || null,
        p.is_default ? 1 : 0,
        id
      ),
    delete: (id: string) => stmts.providers.delete.run(id),
  },
  providerModels: {
    all: () => stmts.providerModels.all.all(),
    byProvider: (id: string) => stmts.providerModels.byProvider.all(id),
    getByModelId: (modelId: string) =>
      stmts.providerModels.byModelId.get(modelId) as ProviderModel | undefined,
    upsert: (m: ProviderModel) =>
      stmts.providerModels.upsert.run(
        m.id,
        m.provider_id,
        m.model_id,
        m.model_name || null,
        m.context_window || null,
        m.max_tokens || null,
        m.reasoning ? 1 : 0,
        JSON.stringify(m.input_types || []),
        m.cost_input || 0,
        m.cost_output || 0,
        m.cost_cache_read || 0,
        m.cost_cache_write || 0
      ),
  },
  mcpServers: {
    all: () => stmts.mcpServers.all.all(),
    get: (id: string) => stmts.mcpServers.get.get(id),
    create: (s: MCPServer) =>
      stmts.mcpServers.create.run(
        s.id,
        s.name,
        s.command,
        s.args || null,
        s.env || null,
        s.url || null,
        s.enabled ? 1 : 0
      ),
    update: (id: string, s: Partial<MCPServer>) =>
      stmts.mcpServers.update.run(
        s.name || null,
        s.command || null,
        s.args || null,
        s.env || null,
        s.url ?? null,
        s.enabled ? 1 : 0,
        id
      ),
    delete: (id: string) => stmts.mcpServers.delete.run(id),
  },
  agents: {
    all: () => stmts.agents.all.all(),
    get: (id: string) => stmts.agents.get.get(id),
    create: (a: Agent) =>
      stmts.agents.create.run(
        a.id,
        a.name,
        a.type || "main",
        a.model || null,
        a.provider_id || null,
        a.system_prompt || null,
        serializeJsonColumn(a.tools),
        serializeJsonColumn(a.config),
        a.status || "stopped",
        a.memory_enabled ? 1 : 0,
        a.fallback_provider_id || null
      ),
    update: (id: string, a: Partial<Agent>) =>
      stmts.agents.update.run(
        a.name || null,
        a.type || null,
        a.model || null,
        a.provider_id || null,
        a.system_prompt || null,
        serializeJsonColumn(a.tools),
        serializeJsonColumn(a.config),
        a.status || null,
        a.memory_enabled ? 1 : 0,
        a.fallback_provider_id || null,
        id
      ),
    updateStatus: (id: string, status: string) => stmts.agents.updateStatus.run(status, id),
    delete: (id: string) => stmts.agents.delete.run(id),
  },
  channels: {
    all: () => stmts.channels.all.all(),
    get: (id: string) => stmts.channels.get.get(id),
    create: (c: Channel) =>
      stmts.channels.create.run(c.id, c.type, c.name, JSON.stringify(c.config), c.enabled ? 1 : 0),
    update: (id: string, c: Partial<Channel>) =>
      stmts.channels.update.run(
        c.name ?? null,
        c.config ? JSON.stringify(c.config) : null,
        c.enabled !== undefined ? (c.enabled ? 1 : 0) : null,
        id
      ),
    delete: (id: string) => stmts.channels.delete.run(id),
  },
  tasks: {
    all: () => stmts.tasks.all.all(),
    get: (id: string) => stmts.tasks.get.get(id),
    create: (t: Task) =>
      stmts.tasks.create.run(
        t.id,
        t.agent_id || null,
        t.name,
        t.type || "scheduled",
        t.schedule || null,
        t.config ? JSON.stringify(t.config) : null,
        t.status || "pending",
        t.next_run || null
      ),
    update: (id: string, t: Partial<Task>) =>
      stmts.tasks.update.run(t.status || null, t.last_run || null, t.next_run || null, id),
    replace: (id: string, t: Task) =>
      stmts.tasks.replace.run(
        t.agent_id || null,
        t.name,
        t.type || "scheduled",
        t.schedule || null,
        t.config ? JSON.stringify(t.config) : null,
        t.status || "pending",
        t.next_run || null,
        id
      ),
    delete: (id: string) => stmts.tasks.delete.run(id),
  },
  taskRuns: {
    getByTask: (taskId: string) => stmts.taskRuns.getByTask.all(taskId) as TaskRun[],
    create: (run: TaskRun) =>
      stmts.taskRuns.create.run(
        run.id,
        run.task_id,
        run.status,
        run.started_at,
        run.completed_at || null,
        run.session_id || null,
        run.result_preview || null,
        run.error || null
      ),
    complete: (
      id: string,
      data: { status: string; session_id?: string; result_preview?: string; error?: string }
    ) =>
      stmts.taskRuns.updateComplete.run(
        data.status,
        new Date().toISOString(),
        data.session_id || null,
        data.result_preview || null,
        data.error || null,
        id
      ),
    getRecent: () => stmts.taskRuns.getRecent.all() as (TaskRun & { task_name: string })[],
  },
  setup: {
    getStep: (step: string) => stmts.setup.getStep.get(step),
    setStep: (step: string, completed: boolean, config?: string) =>
      stmts.setup.setStep.run(step, completed ? 1 : 0, config || null),
    all: () => stmts.setup.all.all(),
    isComplete: () => {
      const ws = stmts.setup.getStep.get("wizard") as { completed?: number } | null;
      return ws?.completed === 1;
    },
  },
  chatSessions: {
    get: (id: string) => stmts.chatSessions?.get.get(id),
    upsert: (session: ChatSessionDB) =>
      stmts.chatSessions?.upsert.run(
        session.id,
        session.agent_id,
        session.title || null,
        session.messages,
        session.workspace_dir || null,
        session.created_at,
        new Date().toISOString()
      ),
    updateWorkspace: (id: string, workspaceDir: string | null) =>
      stmts.chatSessions?.updateWorkspace.run(workspaceDir, id),
    updateTitle: (id: string, title: string | null) =>
      stmts.chatSessions?.updateTitle.run(title, id),
    getWorkspace: (id: string): string | null => {
      const row = stmts.chatSessions?.getWorkspace.get(id) as {
        workspace_dir?: string | null;
      } | null;
      if (!row) return null;
      return typeof row.workspace_dir === "string" && row.workspace_dir.trim().length > 0
        ? row.workspace_dir
        : null;
    },
    getTitle: (id: string): string | null => {
      const row = stmts.chatSessions?.getTitle.get(id) as { title?: string | null } | null;
      if (!row) return null;
      return typeof row.title === "string" && row.title.trim().length > 0 ? row.title : null;
    },
    setPinned: (id: string, pinned: boolean): boolean => {
      const result = stmts.chatSessions?.setPinned.run(pinned ? 1 : 0, id);
      return (result?.changes ?? 0) > 0;
    },
    delete: (id: string) => stmts.chatSessions?.delete.run(id),
    all: () => stmts.chatSessions?.list.all() || [],
  },
  chatMemory: {
    getBySession: (sessionId: string) => stmts.chatMemory?.getBySession.all(sessionId) || [],
    add: (memory: ChatMemoryDB) =>
      stmts.chatMemory?.add.run(
        memory.id,
        memory.session_id,
        memory.type,
        memory.content,
        memory.embedding || null
      ),
    search: (query: string, limit = 10) => stmts.chatMemory?.search.all(`%${query}%`, limit) || [],
  },
  sessionMessages: {
    getBySession: (sessionId: string) => stmts.sessionMessages?.getBySession.all(sessionId) || [],
    add: (msg: {
      id: string;
      session_id: string;
      agent_id?: string;
      channel_type?: string;
      channel_id?: string;
      role: string;
      content: string;
      metadata?: string;
      created_at?: string;
    }) =>
      stmts.sessionMessages?.add.run(
        msg.id,
        msg.session_id,
        msg.agent_id || null,
        msg.channel_type || null,
        msg.channel_id || null,
        msg.role,
        msg.content,
        msg.metadata || null,
        msg.created_at || null
      ),
    list: () => stmts.sessionMessages?.list.all() || [],
    recentByRole: (role: string, limit = 600): Array<{ role: string; content: string }> =>
      (stmts.sessionMessages?.recentByRole.all(role, limit) || []) as Array<{
        role: string;
        content: string;
      }>,
    search: (query: string, limit = 100) =>
      stmts.sessionMessages?.search.all(`%${query}%`, limit) || [],
  },
  systemLogs: {
    add: (log: { id: string; level: string; source: string; message: string; metadata?: string }) =>
      stmts.systemLogs?.add.run(log.id, log.level, log.source, log.message, log.metadata || null),
    getByLevel: (level: string) => stmts.systemLogs?.getByLevel.all(level) || [],
    getBySource: (source: string) => stmts.systemLogs?.getBySource.all(source) || [],
    list: () => stmts.systemLogs?.list.all() || [],
    search: (query: string, limit = 100) => stmts.systemLogs?.search.all(`%${query}%`, limit) || [],
  },
  agentLogs: {
    add: (log: {
      id: string;
      agent_id: string;
      action: string;
      details?: string;
      metadata?: string;
    }) =>
      stmts.agentLogs?.add.run(
        log.id,
        log.agent_id,
        log.action,
        log.details || null,
        log.metadata || null
      ),
    getByAgent: (agentId: string) => stmts.agentLogs?.getByAgent.all(agentId) || [],
    list: () => stmts.agentLogs?.list.all() || [],
  },
  channelLogs: {
    add: (log: {
      id: string;
      channel_type: string;
      channel_id?: string;
      direction: string;
      sender_id?: string;
      content: string;
      metadata?: string;
    }) =>
      stmts.channelLogs?.add.run(
        log.id,
        log.channel_type,
        log.channel_id || null,
        log.direction,
        log.sender_id || null,
        log.content,
        log.metadata || null
      ),
    getByChannel: (channelType: string, channelId: string) =>
      stmts.channelLogs?.getByChannel.all(channelType, channelId) || [],
    list: () => stmts.channelLogs?.list.all() || [],
  },
  metrics: {
    add: (m: { id: string; type: string; key: string; value: number; metadata?: string }) =>
      stmts.metrics?.add.run(m.id, m.type, m.key, m.value, m.metadata || null),
    getByType: (type: string) => stmts.metrics?.getByType.all(type) || [],
    getByTypeRecent: (type: string, limit = 50) =>
      stmts.metrics?.getByTypeRecent.all(type, limit) || [],
    getTotal: (type: string, key: string) =>
      (stmts.metrics?.getTotal.get(type, key) as { total?: number } | null)?.total || 0,
    getTotalByType: (type: string) =>
      (stmts.metrics?.getTotalByType.get(type) as { total?: number } | null)?.total || 0,
    countByType: (type: string) =>
      (stmts.metrics?.countByType.get(type) as { count?: number } | null)?.count || 0,
    countByTypeMetadataLike: (type: string, pattern: string) =>
      (stmts.metrics?.countByTypeMetadataLike.get(type, pattern) as { count?: number } | null)
        ?.count || 0,
    countByTypeSince: (type: string, sinceSql: string) =>
      (stmts.metrics?.countByTypeSince.get(type, sinceSql) as { count?: number } | null)?.count ||
      0,
    countByTypeMetadataLikeSince: (type: string, pattern: string, sinceSql: string) =>
      (
        stmts.metrics?.countByTypeMetadataLikeSince.get(type, pattern, sinceSql) as {
          count?: number;
        } | null
      )?.count || 0,
    getKeyAggregates: (type: string): Array<{ key: string; total: number; count: number }> =>
      (stmts.metrics?.getKeyAggregates.all(type) || []) as Array<{
        key: string;
        total: number;
        count: number;
      }>,
    getKeyTotalsSince: (type: string, sinceSql: string): Array<{ key: string; total: number }> =>
      (stmts.metrics?.getKeyTotalsSince.all(type, sinceSql) || []) as Array<{
        key: string;
        total: number;
      }>,
    getTotalSince: (type: string, key: string, startSql: string, endSql: string) =>
      (stmts.metrics?.getTotalSince.get(type, key, startSql, endSql) as { total?: number } | null)
        ?.total || 0,
    getLatestValue: (type: string, key: string) =>
      (stmts.metrics?.getLatestValue.get(type, key) as { value?: number } | null)?.value ?? null,
    getKeyTotalsWithLatestMetadata: (
      type: string
    ): Array<{ key: string; total: number; metadata: string | null }> =>
      (stmts.metrics?.getKeyTotalsWithLatestMetadata.all(type) || []) as Array<{
        key: string;
        total: number;
        metadata: string | null;
      }>,
    getTopKeys: (type: string) => stmts.metrics?.getTopKeys.all(type) || [],
    getByDate: (type: string, date: string) => stmts.metrics?.getByDate.all(type, date) || [],
    getDailyTotalsFromRaw: (date: string): Array<{ type: string; total: number }> =>
      (stmts.metrics?.getDailyTotalsFromRaw.all(date) || []) as Array<{
        type: string;
        total: number;
      }>,
    getDailyTotalsFromRawRange: (
      start: string,
      end: string
    ): Array<{ date: string; type: string; total: number }> =>
      (stmts.metrics?.getDailyTotalsFromRawRange.all(start, end) || []) as Array<{
        date: string;
        type: string;
        total: number;
      }>,
    addDaily: (d: { id: string; date: string; type: string; key: string; value: number }) =>
      stmts.metrics?.addDaily.run(d.id, d.date, d.type, d.key, d.value),
    getDaily: (date: string, type: string) => stmts.metrics?.getDaily.all(date, type) || [],
    getDailyTotals: (date: string) => stmts.metrics?.getDailyTotals.all(date) || [],
    getDailyTotalsRange: (
      start: string,
      end: string
    ): Array<{ date: string; type: string; total: number }> =>
      (stmts.metrics?.getDailyTotalsRange.all(start, end) || []) as Array<{
        date: string;
        type: string;
        total: number;
      }>,
    deleteOlderThan: (days: number) => stmts.metrics?.deleteOlderThan.run(days),
    count: () => (stmts.metrics?.count.get() as { count: number } | null)?.count || 0,
  },
};

export interface Provider {
  id: string;
  provider: string;
  name: string;
  base_url?: string;
  api_key?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  is_default: boolean;
  headers?: Record<string, string>; // For provider-specific headers (e.g., User-Agent for Kimi Code)
}

export interface ProviderModel {
  id: string;
  provider_id: string;
  model_id: string;
  model_name?: string;
  context_window?: number;
  max_tokens?: number;
  reasoning?: boolean;
  input_types?: string[];
  cost_input?: number;
  cost_output?: number;
  cost_cache_read?: number;
  cost_cache_write?: number;
}

export interface MCPServer {
  id: string;
  name: string;
  command: string;
  args?: string;
  env?: string;
  url?: string;
  enabled: boolean;
}

export interface Agent {
  id: string;
  name: string;
  type?: "main" | "subagent" | "worker" | "research" | "coder" | "planner" | "ops";
  model?: string;
  provider_id?: string;
  fallback_provider_id?: string;
  system_prompt?: string;
  tools?: ToolDefinition[];
  config?: Record<string, unknown>;
  status: "running" | "stopped" | "error";
  memory_enabled: boolean;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  handler?: string;
}

export interface Channel {
  id: string;
  type:
    | "telegram"
    | "whatsapp"
    | "discord"
    | "slack"
    | "signal"
    | "imessage"
    | "web"
    | "webhook"
    | "sms"
    | "email"
    | "matrix"
    | "mattermost"
    | "irc"
    | "ntfy"
    | "twitch"
    | "line"
    | "googlechat"
    | "msteams"
    | "feishu"
    | "dingtalk"
    | "wecom"
    | "homeassistant"
    | "zulip"
    | "synology"
    | "nextcloud"
    | "zalo";
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface Task {
  id: string;
  agent_id?: string;
  name: string;
  type?: "scheduled" | "triggered" | "recurring";
  schedule?: string;
  action?: string;
  description?: string;
  config?: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "paused";
  enabled?: boolean;
  last_run?: string;
  next_run?: string;
}

export interface TaskRun {
  id: string;
  task_id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at?: string;
  session_id?: string;
  result_preview?: string;
  error?: string;
}

export interface ChatSessionDB {
  id: string;
  agent_id: string;
  title?: string | null;
  messages: string;
  workspace_dir?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface ChatMemoryDB {
  id: string;
  session_id: string;
  type: "tool" | "object" | "operator" | "narrative";
  content: string;
  embedding?: string;
  created_at: string;
}

export default db;
