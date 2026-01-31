// Tool handlers - memory system
import {
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  appendFileSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getVectorStore } from "../../memory";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Memory directory is at project root level (src/core/tools/handlers -> root)
const memoryDir = join(__dirname, "..", "..", "..", "..", "memory");

// Ensure memory directory exists
if (!existsSync(memoryDir)) {
  mkdirSync(memoryDir, { recursive: true });
}

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
