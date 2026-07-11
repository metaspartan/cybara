import {
  readFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
  appendFileSync,
  statSync,
  realpathSync,
} from "fs";
import { join, resolve, sep, dirname } from "path";
import {
  getVectorStore,
  saveDurableMemory,
  getRecentMemoryContext,
  loadHeartbeatState,
  recordCheck,
  getDueChecks,
  isQuietHours,
  getHeartbeatSummary,
  setQuietHours,
  getActiveMemoryProviderAdapter,
  type DurableMemoryEntry,
  type HeartbeatState,
} from "../../memory";
import { memoryDir } from "../../paths";
import { searchSessionMessages } from "../../session-search";
import { config } from "../../config";

/**
 * Resolve `candidate` and assert it stays inside `memoryDir`, following symlinks
 * on whatever portion of the path already exists. Rejects absolute paths that
 * escape the memory dir, `..` traversal, and symlinked escapes. Confinement to
 * the memory dir (rather than the general deny-list) is the right control here:
 * memoryDir lives under ~/.cybara, so the deny-list would reject it, yet
 * containment already excludes the wallet/keys/session siblings.
 */
function assertWithinMemoryDir(candidate: string): void {
  let root: string;
  try {
    root = realpathSync.native(memoryDir);
  } catch {
    root = resolve(memoryDir);
  }

  const absolute = resolve(candidate);
  let real = absolute;
  let existing = absolute;
  while (existing && existing !== dirname(existing) && !existsSync(existing)) {
    existing = dirname(existing);
  }
  try {
    if (existsSync(existing)) {
      const realExisting = realpathSync.native(existing);
      const suffix = absolute.slice(existing.length);
      real = suffix ? join(realExisting, suffix) : realExisting;
    }
  } catch {
    real = absolute;
  }

  if (real !== root && !real.startsWith(root + sep)) {
    throw new Error("Refused: memory_get can only read files inside the memory directory.");
  }
}

let vectorStoreInitialized = false;

// Memory tools honor the embedding provider/model configured in settings
// (including the local keyword-only mode) instead of whatever "auto" resolved
// to at startup. configureEmbeddings is a no-op when the selection is
// unchanged.
async function getConfiguredVectorStore(): Promise<ReturnType<typeof getVectorStore>> {
  const vectorStore = getVectorStore();
  try {
    const settings = config.getWorkspaceIndexerSettings();
    await vectorStore.configureEmbeddings({
      provider: settings.embeddingProvider,
      model: settings.embeddingModel,
    });
  } catch {
    await vectorStore.ensureReady();
  }
  return vectorStore;
}

async function ensureVectorStoreIndexed(): Promise<void> {
  if (vectorStoreInitialized) return;

  const vectorStore = await getConfiguredVectorStore();
  await vectorStore.ensureReady();

  if (!existsSync(memoryDir)) {
    vectorStoreInitialized = true;
    return;
  }

  try {
    const files = readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
    let indexed = 0;

    for (const file of files) {
      const filePath = join(memoryDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const chunks = await vectorStore.indexFile(`memory/${file}`, content, "memory");
        if (chunks > 0) indexed++;
      } catch {
        void 0;
      }
    }

    console.log(`[Memory] Indexed ${indexed} files into vector store`);
  } catch (error) {
    console.error("[Memory] Vector store indexing error:", error);
  }

  vectorStoreInitialized = true;
}

export async function handleMemorySearch(args: Record<string, unknown>): Promise<{
  results: Array<{ file: string; content: string; score: number; method: string }>;
  query: string;
  searchMethod: string;
}> {
  const query = args.query as string;
  const maxResults = (args.maxResults as number) || 5;
  const minScore = (args.minScore as number) || 0.3;

  if (!query) {
    throw new Error("Query is required");
  }

  await ensureVectorStoreIndexed();

  const vectorStore = await getConfiguredVectorStore();
  const stats = vectorStore.stats();
  const externalResultsPromise = searchExternalMemoryProvider(query, maxResults);
  const semanticProvider = stats.provider !== "none" && stats.provider !== "local";
  const indexMethod = semanticProvider ? "semantic" : "keyword";

  if (stats.provider !== "none" && stats.chunks > 0) {
    try {
      const vectorResults = await vectorStore.search(query, {
        maxResults,
        minScore,
        source: "memory",
      });

      if (vectorResults.length > 0) {
        return {
          results: [
            ...vectorResults.map((r) => ({
              file: r.path.replace("memory/", ""),
              content: r.content,
              score: r.score,
              method: indexMethod,
            })),
            ...(await externalResultsPromise),
          ],
          query,
          searchMethod: semanticProvider
            ? `semantic (${stats.provider}/${stats.model})`
            : "keyword (local index)",
        };
      }
    } catch (error) {
      console.warn("[Memory] Indexed search failed, falling back to file scan:", error);
    }
  }

  const results: Array<{ file: string; content: string; score: number; method: string }> = [];

  if (!existsSync(memoryDir)) {
    return { results, query, searchMethod: "keyword (no memory files)" };
  }

  try {
    const files = readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);

    for (const file of files) {
      const filePath = join(memoryDir, file);
      try {
        const content = readFileSync(filePath, "utf-8");
        const contentLower = content.toLowerCase();

        let score = 0;
        for (const word of queryWords) {
          const matches = (contentLower.match(new RegExp(word, "g")) || []).length;
          score += matches;
        }

        if (score > 0) {
          const normalizedScore = Math.min(1, score / (queryWords.length * 3));

          const lines = content.split("\n");
          let bestSection = "";
          let bestSectionScore = 0;

          for (let i = 0; i < lines.length; i++) {
            const section = lines.slice(i, i + 5).join("\n");
            const sectionLower = section.toLowerCase();
            let sectionScore = 0;
            for (const word of queryWords) {
              if (sectionLower.includes(word)) sectionScore++;
            }
            if (sectionScore > bestSectionScore) {
              bestSectionScore = sectionScore;
              bestSection = section;
            }
          }

          results.push({
            file,
            content: bestSection.slice(0, 500) || content.slice(0, 500),
            score: normalizedScore,
            method: "keyword",
          });
        }
      } catch {
        void 0;
      }
    }

    results.sort((a, b) => b.score - a.score);
    results.splice(maxResults);
  } catch (error) {
    console.error("Memory search error:", error);
  }

  return {
    results: [...results, ...(await externalResultsPromise)],
    query,
    searchMethod:
      stats.provider !== "none"
        ? `keyword file scan (index returned no results: ${stats.chunks} chunks indexed)`
        : "keyword file scan (no index available)",
  };
}

async function searchExternalMemoryProvider(
  query: string,
  maxResults: number
): Promise<Array<{ file: string; content: string; score: number; method: string }>> {
  try {
    const settings = config.getMemoryProviderSettings();
    const adapter = getActiveMemoryProviderAdapter(settings);
    if (!adapter) return [];
    // Explicit tool searches always query the provider; autoRecall only gates
    // the automatic context injection.
    const external = await adapter.search(settings, query, maxResults);
    return external.map((entry) => ({
      file: `${adapter.label} (external)`,
      content: entry.content,
      score: entry.score ?? 0.5,
      method: adapter.id,
    }));
  } catch {
    return [];
  }
}

export async function handleMemoryGet(
  args: Record<string, unknown>
): Promise<{ content: string; path: string; lines: number }> {
  const path = args.path as string;
  const from = (args.from as number) || 1;
  const lines = (args.lines as number) || undefined;

  if (!path) {
    throw new Error("Path is required");
  }

  if (path.includes("\0")) {
    throw new Error("Invalid memory path");
  }

  const filePath = path.startsWith("/") ? path : join(memoryDir, path);

  // Reject anything that escapes the memory directory so `memory_get` can never
  // be used to read arbitrary host files (e.g. ~/.ssh/id_rsa, /etc/passwd, or the
  // sibling wallet/keys files under ~/.cybara).
  assertWithinMemoryDir(filePath);

  if (!existsSync(filePath)) {
    throw new Error(`Memory file not found: ${path}`);
  }

  const content = readFileSync(filePath, "utf-8");
  let linesArr = content.split("\n");

  if (from > 1) {
    linesArr = linesArr.slice(from - 1);
  }
  if (lines) {
    linesArr = linesArr.slice(0, lines);
  }

  return {
    content: linesArr.join("\n"),
    path,
    lines: linesArr.length,
  };
}

/** Coerce a caller-supplied `tags` value into a clean string[] regardless of shape. */
function normalizeTagList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter((t) => t.length > 0);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }
  return [];
}

export async function handleMemorySave(
  args: Record<string, unknown>
): Promise<{ success: boolean; path: string; type: string; indexed: boolean }> {
  const content = args.content as string;
  const type = (args.type as string) || "context";
  // Coerce tags robustly: models pass an array, a comma-separated string, or
  // omit it entirely. Never assume Array so `.join` can't blow up the call.
  const tags = normalizeTagList(args.tags);

  if (!content) {
    throw new Error("Content is required");
  }

  const today = new Date().toISOString().split("T")[0];
  const filePath = join(memoryDir, `${today}.md`);
  const fileName = `${today}.md`;

  if (!existsSync(filePath)) {
    writeFileSync(filePath, `# Memory - ${today}\n\n`);
  }

  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  const tagsStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
  const entry = `\n## ${timestamp} - ${type}${tagsStr}\n\n${content}\n`;

  appendFileSync(filePath, entry);

  let indexed = false;
  try {
    const vectorStore = await getConfiguredVectorStore();
    await vectorStore.ensureReady();

    const fullContent = readFileSync(filePath, "utf-8");
    const chunks = await vectorStore.indexFile(`memory/${fileName}`, fullContent, "memory");
    indexed = chunks > 0;
  } catch (error) {
    console.warn("[Memory] Failed to index to vector store:", error);
  }

  return {
    success: true,
    path: filePath,
    type,
    indexed,
  };
}

export async function handleMemoryList(): Promise<{
  files: Array<{ name: string; date: string; size: number }>;
}> {
  if (!existsSync(memoryDir)) {
    return { files: [] };
  }

  const files = readdirSync(memoryDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const filePath = join(memoryDir, f);
      const stats = statSync(filePath);
      return {
        name: f,
        date: f.replace(".md", ""),
        size: stats.size,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return { files };
}

export function getTodayMemoryPath(): string {
  const today = new Date().toISOString().split("T")[0];
  return join(memoryDir, `${today}.md`);
}

export function initializeTodayMemory(): void {
  const filePath = getTodayMemoryPath();
  if (!existsSync(filePath)) {
    const today = new Date().toISOString().split("T")[0];
    writeFileSync(filePath, `# Memory - ${today}\n\n`);
  }
}

export async function handleMemorySaveDurable(
  args: Record<string, unknown>
): Promise<{ success: boolean; path: string; category: string; indexed: boolean }> {
  const content = args.content as string;
  const category = (args.category as DurableMemoryEntry["category"]) || "fact";
  const source = args.source as string | undefined;

  if (!content) {
    throw new Error("Content is required");
  }

  const validCategories = ["preference", "decision", "convention", "goal", "fact"];
  if (!validCategories.includes(category)) {
    throw new Error(`Invalid category. Must be one of: ${validCategories.join(", ")}`);
  }

  const result = await saveDurableMemory({
    category,
    content,
    source,
  });

  return {
    success: result.success,
    path: result.path,
    category,
    indexed: result.indexed,
  };
}

export async function handleMemoryContext(
  args: Record<string, unknown>
): Promise<{ context: string; lines: number }> {
  const maxLines = (args.maxLines as number) || 50;
  const isPrivate = (args.isPrivate as boolean) || false;

  const context = getRecentMemoryContext(maxLines, isPrivate);

  return {
    context,
    lines: context.split("\n").length,
  };
}

export async function handleHeartbeatState(args: Record<string, unknown>): Promise<{
  action: string;
  state?: HeartbeatState;
  dueChecks?: string[];
  summary?: string;
  isQuiet?: boolean;
}> {
  const action = (args.action as string) || "status";

  switch (action) {
    case "status": {
      const state = loadHeartbeatState();
      return {
        action: "status",
        state,
        isQuiet: isQuietHours(),
        summary: getHeartbeatSummary(),
      };
    }

    case "record": {
      const checkName = args.checkName as string;
      if (!checkName) {
        throw new Error("checkName is required for record action");
      }
      const state = recordCheck(checkName);
      return { action: "record", state };
    }

    case "due": {
      const intervals = (args.intervals as Record<string, number>) || {
        email: 60, // Check email every hour
        calendar: 120, // Check calendar every 2 hours
        weather: 360, // Check weather every 6 hours
        mentions: 30, // Check social mentions every 30 min
      };
      const dueChecks = getDueChecks(intervals);
      return {
        action: "due",
        dueChecks,
        isQuiet: isQuietHours(),
      };
    }

    case "quiet": {
      const start = args.start as number;
      const end = args.end as number;
      if (start !== undefined && end !== undefined) {
        setQuietHours(start, end);
      }
      return {
        action: "quiet",
        isQuiet: isQuietHours(),
        state: loadHeartbeatState(),
      };
    }

    default:
      throw new Error(`Unknown action: ${action}. Use: status, record, due, quiet`);
  }
}

export async function handleSessionSearch(args: Record<string, unknown>): Promise<{
  query: string;
  results: Array<{
    sessionId: string;
    sessionTitle: string | null;
    role: string;
    snippet: string;
    createdAt: string;
  }>;
  totalReturned: number;
}> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    throw new Error("Query is required");
  }
  const results = searchSessionMessages(query, {
    limit: typeof args.maxResults === "number" ? args.maxResults : 20,
    offset: typeof args.offset === "number" ? args.offset : 0,
    sessionId: typeof args.sessionId === "string" ? args.sessionId : undefined,
    agentId: typeof args.agentId === "string" ? args.agentId : undefined,
    role: typeof args.role === "string" ? args.role : undefined,
  });
  return {
    query,
    results: results.map((hit) => ({
      sessionId: hit.sessionId,
      sessionTitle: hit.sessionTitle,
      role: hit.role,
      snippet: hit.snippet,
      createdAt: hit.createdAt,
    })),
    totalReturned: results.length,
  };
}
