// Memory management API
import { readFileSync, existsSync, writeFileSync, unlinkSync, readdirSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { memoryDir } from "../../core/paths";

export interface MemoryEntry {
  timestamp: string;
  date: string;
  type: string;
  tags: string[];
  content: string;
  index: number;
}

function getMemoryFiles(): string[] {
  if (!existsSync(memoryDir)) return [];
  return readdirSync(memoryDir)
    .filter(f => f.endsWith(".md"))
    .sort()
    .reverse();
}

function parseDateFromFilename(filename: string): string {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function parseMemoryFile(content: string, filename: string): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  const lines = content.split("\n");
  let currentEntry: MemoryEntry | null = null;
  let entryIndex = 0;
  const fileDate = parseDateFromFilename(filename);

  for (const line of lines) {
    const timestampMatch = line.match(/^## (\d{2}:\d{2}:\d{2}) - (\w+) \[([^\]]+)\]/);
    if (timestampMatch) {
      if (currentEntry) {
        currentEntry.index = entryIndex++;
        entries.push(currentEntry);
      }
      currentEntry = {
        timestamp: timestampMatch[1],
        date: fileDate,
        type: timestampMatch[2],
        tags: timestampMatch[3].split(", ").map(t => t.trim()),
        content: "",
        index: entryIndex,
      };
    } else if (currentEntry && line.trim() && !line.startsWith("#")) {
      currentEntry.content += line + "\n";
    }
  }
  if (currentEntry) {
    currentEntry.index = entryIndex;
    entries.push(currentEntry);
  }
  return entries;
}

export async function handleMemoryList(): Promise<{ files: string[]; memories: Array<{ file: string; entries: MemoryEntry[] }> }> {
  const files = getMemoryFiles();
  const memories: Array<{ file: string; entries: MemoryEntry[] }> = [];

  for (const file of files) {
    const path = join(memoryDir, file);
    if (existsSync(path)) {
      const content = readFileSync(path, "utf-8");
      const entries = parseMemoryFile(content, file);
      memories.push({ file, entries });
    }
  }

  return { files, memories };
}

export async function handleMemoryDelete(file: string, index?: number): Promise<{ success: boolean }> {
  const path = join(memoryDir, file);
  if (!existsSync(path)) {
    throw new Error("Memory file not found");
  }

  const content = readFileSync(path, "utf-8");
  const entries = parseMemoryFile(content, file);

  if (index !== undefined && index >= 0 && index < entries.length) {
    entries.splice(index, 1);
    const newContent = `# ${file.replace(".md", "")}\n\n` +
      entries.map((e) => `## ${e.timestamp} - ${e.type} [${e.tags.join(", ")}]\n\n${e.content.trim()}`).join("\n\n");
    writeFileSync(path, newContent);
  } else {
    unlinkSync(path);
  }

  return { success: true };
}

export async function handleMemorySearch(query: string): Promise<{ results: Array<{ file: string; entry: MemoryEntry }> }> {
  const files = getMemoryFiles();
  const results: Array<{ file: string; entry: MemoryEntry }> = [];
  const lowerQuery = query.toLowerCase();

  for (const file of files) {
    const path = join(memoryDir, file);
    if (existsSync(path)) {
      const content = readFileSync(path, "utf-8");
      const entries = parseMemoryFile(content, file);
      for (const entry of entries) {
        if (entry.content.toLowerCase().includes(lowerQuery) ||
          entry.tags.some(t => t.toLowerCase().includes(lowerQuery))) {
          results.push({ file, entry });
        }
      }
    }
  }

  return { results };
}

export async function handleMemoryEdit(file: string, index: number, newContent: string): Promise<{ success: boolean }> {
  const path = join(memoryDir, file);
  if (!existsSync(path)) {
    throw new Error("Memory file not found");
  }

  const content = readFileSync(path, "utf-8");
  const entries = parseMemoryFile(content, file);

  if (index >= 0 && index < entries.length) {
    entries[index].content = newContent;
    const newFileContent = `# ${file.replace(".md", "")}\n\n` +
      entries.map((e) => `## ${e.timestamp} - ${e.type} [${e.tags.join(", ")}]\n\n${e.content.trim()}`).join("\n\n");
    writeFileSync(path, newFileContent);
  } else {
    throw new Error("Entry index not found");
  }

  return { success: true };
}

export async function handleMemoryCreate(
  file: string,
  content: string
): Promise<{ success: boolean; file: string }> {
  const trimmedFile = file.trim();
  const trimmedContent = content.trim();

  if (!trimmedFile) {
    throw new Error("Validation error: file is required");
  }
  if (!trimmedContent) {
    throw new Error("Validation error: content is required");
  }

  const safeBaseName = basename(trimmedFile).replace(/[^\w.-]/g, "-");
  const finalFileName = safeBaseName.endsWith(".md") ? safeBaseName : `${safeBaseName}.md`;
  const path = join(memoryDir, finalFileName);

  if (existsSync(path)) {
    throw new Error("Memory file already exists");
  }

  mkdirSync(memoryDir, { recursive: true });

  const now = new Date();
  const timestamp = now.toTimeString().slice(0, 8);
  const title = finalFileName.replace(/\.md$/i, "");
  const fileContent = `# ${title}\n\n## ${timestamp} - note [manual]\n\n${trimmedContent}\n`;

  writeFileSync(path, fileContent, "utf-8");
  return { success: true, file: finalFileName };
}
