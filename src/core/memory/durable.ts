/**
 * Durable Memory Management
 * OpenClaw-compatible MEMORY.md for persistent user preferences, decisions, and long-term facts
 * 
 * Unlike daily logs (YYYY-MM-DD.md), MEMORY.md is curated and persists across sessions.
 * It stores:
 * - User preferences
 * - Important decisions
 * - Project conventions
 * - Long-term goals
 * - Critical facts that should never be forgotten
 */

import { readFileSync, existsSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { memoryDir } from "../paths";
import { getVectorStore } from "./vector-store";

const MEMORY_FILE = "MEMORY.md";
const MEMORY_PATH = join(memoryDir, MEMORY_FILE);

/**
 * Memory entry structure for MEMORY.md
 */
export interface DurableMemoryEntry {
    category: "preference" | "decision" | "convention" | "goal" | "fact";
    content: string;
    timestamp: string;
    source?: string;
}

/**
 * Get the path to MEMORY.md
 */
export function getDurableMemoryPath(): string {
    return MEMORY_PATH;
}

/**
 * Initialize MEMORY.md if it doesn't exist
 */
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

/**
 * Read all durable memories from MEMORY.md
 */
export function readDurableMemory(): string {
    initDurableMemory();
    return readFileSync(MEMORY_PATH, "utf-8");
}

/**
 * Parse MEMORY.md into structured entries
 */
export function parseDurableMemory(): DurableMemoryEntry[] {
    const content = readDurableMemory();
    const entries: DurableMemoryEntry[] = [];

    // Match entries like: ## preference [2024-01-15 10:30:00]
    const entryRegex = /^## (\w+) \[([^\]]+)\](?: from (.+))?\n([\s\S]*?)(?=^## |\n---|\Z)/gm;
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

/**
 * Save a new durable memory entry
 */
export async function saveDurableMemory(entry: Omit<DurableMemoryEntry, "timestamp">): Promise<{
    success: boolean;
    path: string;
    indexed: boolean;
}> {
    initDurableMemory();

    const timestamp = new Date().toISOString().replace("T", " ").split(".")[0];
    const sourceStr = entry.source ? ` from ${entry.source}` : "";

    const entryText = `\n## ${entry.category} [${timestamp}]${sourceStr}\n\n${entry.content.trim()}\n`;

    appendFileSync(MEMORY_PATH, entryText);

    // Re-index MEMORY.md in vector store
    let indexed = false;
    try {
        const vectorStore = getVectorStore();
        await vectorStore.ensureReady();
        const fullContent = readFileSync(MEMORY_PATH, "utf-8");
        const chunks = await vectorStore.indexFile(`memory/${MEMORY_FILE}`, fullContent, "memory");
        indexed = chunks > 0;
    } catch (error) {
        console.warn("[Memory] Failed to index MEMORY.md:", error);
    }

    return {
        success: true,
        path: MEMORY_PATH,
        indexed,
    };
}

/**
 * Get a summary of durable memories by category
 */
export function getDurableMemorySummary(): Record<string, number> {
    const entries = parseDurableMemory();
    const summary: Record<string, number> = {};

    for (const entry of entries) {
        summary[entry.category] = (summary[entry.category] || 0) + 1;
    }

    return summary;
}

/**
 * Search durable memories for specific content
 */
export function searchDurableMemory(query: string): DurableMemoryEntry[] {
    const entries = parseDurableMemory();
    const lowerQuery = query.toLowerCase();

    return entries.filter(entry =>
        entry.content.toLowerCase().includes(lowerQuery) ||
        entry.category.toLowerCase().includes(lowerQuery)
    );
}

/**
 * Get recent context for system prompt injection
 * Returns MEMORY.md content + last 1-2 days of daily logs
 */
export function getRecentMemoryContext(maxLines: number = 50): string {
    const lines: string[] = [];

    // Add durable memories first (always include)
    if (existsSync(MEMORY_PATH)) {
        const durableContent = readFileSync(MEMORY_PATH, "utf-8");
        const durableLines = durableContent.split("\n").slice(0, Math.floor(maxLines / 2));
        if (durableLines.length > 0) {
            lines.push("## Durable Memories (MEMORY.md)");
            lines.push(...durableLines);
            lines.push("");
        }
    }

    // Add today's and yesterday's logs
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
