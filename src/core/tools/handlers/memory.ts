// Tool handlers - memory system
import {
  readFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
  appendFileSync,
  statSync,
} from "fs";
import { join } from "path";
import { getVectorStore, saveDurableMemory, getRecentMemoryContext, type DurableMemoryEntry } from "../../memory";
import { memoryDir } from "../../paths";

// Track if vector store has been indexed
let vectorStoreInitialized = false;

/**
 * Index all memory files into the vector store (called once at startup or on first search)
 */
async function ensureVectorStoreIndexed(): Promise<void> {
  if (vectorStoreInitialized) return;

  const vectorStore = getVectorStore();
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
        // Skip unreadable files
      }
    }

    console.log(`[Memory] Indexed ${indexed} files into vector store`);
  } catch (error) {
    console.error("[Memory] Vector store indexing error:", error);
  }

  vectorStoreInitialized = true;
}

export async function handleMemorySearch(
  args: Record<string, unknown>
): Promise<{
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

  // Ensure vector store is indexed
  await ensureVectorStoreIndexed();

  const vectorStore = getVectorStore();
  const stats = vectorStore.stats();

  // Try semantic search first
  if (stats.provider !== "none" && stats.chunks > 0) {
    try {
      const vectorResults = await vectorStore.search(query, {
        maxResults,
        minScore,
        source: "memory",
      });

      if (vectorResults.length > 0) {
        return {
          results: vectorResults.map(r => ({
            file: r.path.replace("memory/", ""),
            content: r.content,
            score: r.score,
            method: "semantic",
          })),
          query,
          searchMethod: `semantic (${stats.provider}/${stats.model})`,
        };
      }
    } catch (error) {
      console.warn("[Memory] Semantic search failed, falling back to keyword:", error);
    }
  }

  // Fallback to keyword search
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

        // Calculate relevance score
        let score = 0;
        for (const word of queryWords) {
          const matches = (contentLower.match(new RegExp(word, "g")) || []).length;
          score += matches;
        }

        if (score > 0) {
          // Normalize score to 0-1 range
          const normalizedScore = Math.min(1, score / (queryWords.length * 3));

          // Find the most relevant section
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
        // Skip unreadable files
      }
    }

    // Sort by score and limit results
    results.sort((a, b) => b.score - a.score);
    results.splice(maxResults);
  } catch (error) {
    console.error("Memory search error:", error);
  }

  return {
    results,
    query,
    searchMethod: stats.provider !== "none"
      ? `keyword (semantic unavailable: ${stats.chunks} chunks indexed)`
      : "keyword (no embedding provider)",
  };
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

  // Handle relative paths
  let filePath = path;
  if (!path.startsWith("/")) {
    filePath = join(memoryDir, path);
  }

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

export async function handleMemorySave(
  args: Record<string, unknown>
): Promise<{ success: boolean; path: string; type: string; indexed: boolean }> {
  const content = args.content as string;
  const type = (args.type as string) || "context";
  const tags = (args.tags as string[]) || [];

  if (!content) {
    throw new Error("Content is required");
  }

  // Get today's memory file
  const today = new Date().toISOString().split("T")[0];
  const filePath = join(memoryDir, `${today}.md`);
  const fileName = `${today}.md`;

  // Create file with header if it doesn't exist
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `# Memory - ${today}\n\n`);
  }

  // Format the memory entry
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  const tagsStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
  const entry = `\n## ${timestamp} - ${type}${tagsStr}\n\n${content}\n`;

  // Append to the file
  appendFileSync(filePath, entry);

  // Re-index this file in the vector store
  let indexed = false;
  try {
    const vectorStore = getVectorStore();
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

// List all memory files
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

// Create today's memory file if it doesn't exist
export function getTodayMemoryPath(): string {
  const today = new Date().toISOString().split("T")[0];
  return join(memoryDir, `${today}.md`);
}

// Initialize today's memory file
export function initializeTodayMemory(): void {
  const filePath = getTodayMemoryPath();
  if (!existsSync(filePath)) {
    const today = new Date().toISOString().split("T")[0];
    writeFileSync(filePath, `# Memory - ${today}\n\n`);
  }
}

/**
 * Save a durable memory to MEMORY.md
 * For persistent preferences, decisions, conventions, goals, and critical facts
 */
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

/**
 * Get recent memory context for injection into prompts
 * Returns MEMORY.md + last 1-2 days of daily logs
 */
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

/**
 * Manage heartbeat state for periodic checks
 * Tracks last check times for services like email, calendar, weather, mentions
 */
export async function handleHeartbeatState(
  args: Record<string, unknown>
): Promise<{
  action: string;
  state?: import("../../memory").HeartbeatState;
  dueChecks?: string[];
  summary?: string;
  isQuiet?: boolean;
}> {
  const {
    loadHeartbeatState,
    recordCheck,
    getDueChecks,
    isQuietHours,
    getHeartbeatSummary,
    setQuietHours
  } = await import("../../memory");

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
      // Default check intervals in minutes
      const intervals = (args.intervals as Record<string, number>) || {
        email: 60,       // Check email every hour
        calendar: 120,   // Check calendar every 2 hours
        weather: 360,    // Check weather every 6 hours
        mentions: 30,    // Check social mentions every 30 min
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
