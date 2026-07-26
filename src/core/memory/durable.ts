import { readFileSync, existsSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { memoryDir } from "../paths";
import { getVectorStore } from "./vector-store";
import { sanitizeMemoryContent } from "./sanitize";
import { captureToExternalMemory } from "./providers";
import { config } from "../config";

const MEMORY_FILE = "MEMORY.md";
const MEMORY_PATH = join(memoryDir, MEMORY_FILE);
let durableSaveQueue: Promise<void> = Promise.resolve();

export interface DurableMemoryEntry {
  category: "preference" | "decision" | "convention" | "goal" | "fact";
  content: string;
  timestamp: string;
  source?: string;
}

export function getDurableMemoryPath(): string {
  return MEMORY_PATH;
}

export function initDurableMemory(): void {
  if (!existsSync(MEMORY_PATH)) {
    const header = `# Durable Memory

This file contains persistent memories that should be retained across sessions.
Use memory_save_durable to add entries here.

---

`;
    writeFileSync(MEMORY_PATH, header);
    console.log("[Memory] Created MEMORY.md");
  }
}

export function readDurableMemory(): string {
  initDurableMemory();
  return readFileSync(MEMORY_PATH, "utf-8");
}

export function parseDurableMemory(): DurableMemoryEntry[] {
  const content = readDurableMemory();
  const entries: DurableMemoryEntry[] = [];

  const entryRegex = /^## (\w+) \[([^\]]+)\](?: from (.+))?\n([\s\S]*?)(?=^## |\n---|$)/gm;
  let match;

  while ((match = entryRegex.exec(content)) !== null) {
    entries.push({
      category: match[1] as DurableMemoryEntry["category"],
      timestamp: match[2],
      source: match[3]?.trim(),
      content: match[4].trim(),
    });
  }

  return entries;
}

async function performDurableMemorySave(entry: Omit<DurableMemoryEntry, "timestamp">): Promise<{
  success: boolean;
  path: string;
  indexed: boolean;
}> {
  initDurableMemory();
  const previousContent = readFileSync(MEMORY_PATH, "utf-8");

  const timestamp = new Date().toISOString().replace("T", " ").split(".")[0];
  const sourceStr = entry.source ? ` from ${entry.source}` : "";

  const safeContent = sanitizeMemoryContent(entry.content).trim();
  const entryText = `\n## ${entry.category} [${timestamp}]${sourceStr}\n\n${safeContent}\n`;

  appendFileSync(MEMORY_PATH, entryText);

  let indexed = false;
  try {
    const vectorStore = getVectorStore();
    await vectorStore.ensureReady();
    const lineOffset = previousContent.match(/\n/g)?.length ?? 0;
    const appended = await vectorStore.appendFileContent(
      `memory/${MEMORY_FILE}`,
      entryText,
      lineOffset,
      "memory"
    );
    const chunks =
      appended ??
      (await vectorStore.indexFile(
        `memory/${MEMORY_FILE}`,
        readFileSync(MEMORY_PATH, "utf-8"),
        "memory"
      ));
    indexed = chunks > 0;
  } catch (error) {
    console.warn("[Memory] Failed to index MEMORY.md:", error);
  }

  void mirrorToExternalProvider(entry.category, safeContent, entry.source);

  return {
    success: true,
    path: MEMORY_PATH,
    indexed,
  };
}

export function saveDurableMemory(entry: Omit<DurableMemoryEntry, "timestamp">): Promise<{
  success: boolean;
  path: string;
  indexed: boolean;
}> {
  const save = durableSaveQueue.then(() => performDurableMemorySave(entry));
  durableSaveQueue = save.then(
    () => undefined,
    () => undefined
  );
  return save;
}

async function mirrorToExternalProvider(
  category: string,
  content: string,
  source?: string
): Promise<void> {
  try {
    const settings = config.getMemoryProviderSettings();
    const metadata: Record<string, string> = { category, app: "cybara" };
    if (source) metadata.source = source;
    await captureToExternalMemory(settings, content, metadata);
  } catch {}
}

export function getDurableMemorySummary(): Record<string, number> {
  const entries = parseDurableMemory();
  const summary: Record<string, number> = {};

  for (const entry of entries) {
    summary[entry.category] = (summary[entry.category] || 0) + 1;
  }

  return summary;
}

export function searchDurableMemory(query: string): DurableMemoryEntry[] {
  const entries = parseDurableMemory();
  const lowerQuery = query.toLowerCase();

  return entries.filter(
    (entry) =>
      entry.content.toLowerCase().includes(lowerQuery) ||
      entry.category.toLowerCase().includes(lowerQuery)
  );
}

export function getRecentMemoryContext(
  maxLines: number = 50,
  isPrivateSession: boolean = false
): string {
  const lines: string[] = [];

  if (!isPrivateSession && existsSync(MEMORY_PATH)) {
    const durableContent = readFileSync(MEMORY_PATH, "utf-8");
    const durableLines = durableContent.split("\n").slice(0, Math.floor(maxLines / 2));
    if (durableLines.length > 0) {
      lines.push("## Durable Memories (MEMORY.md)");
      lines.push(...durableLines);
      lines.push("");
    }
  }

  const today = new Date();
  const dates = [
    today.toISOString().split("T")[0],
    new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0],
  ];

  const remainingLines = maxLines - lines.length;
  const linesPerDay = Math.floor(remainingLines / 2);

  for (const date of dates) {
    const logPath = join(memoryDir, `${date}.md`);
    if (existsSync(logPath)) {
      const content = readFileSync(logPath, "utf-8");
      const logLines = content.split("\n").slice(-linesPerDay);
      if (logLines.length > 0) {
        lines.push(`## Daily Log (${date})`);
        lines.push(...logLines);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

export function isPrivateSessionContext(channel?: string): boolean {
  if (!channel) return false;

  const privatePatterns = [/^discord:/i, /^slack:/i, /^group:/i, /^shared:/i, /^channel:/i];

  return privatePatterns.some((pattern) => pattern.test(channel));
}
