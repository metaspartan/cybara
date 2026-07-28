function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function promptFromMessages(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const message = value[index];
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const record = message as Record<string, unknown>;
    if (record.role !== "user") continue;
    const content = readString(record, "content");
    if (content) return content;
  }
  return null;
}

function promptFromJson(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return (
    readString(record, "prompt") ??
    readString(record, "instruction") ??
    readString(record, "input") ??
    promptFromMessages(record.messages)
  );
}

export function parseDatasetPrompts(source: string): string[] {
  const lines = source.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    return trimmed ? [trimmed] : [];
  });
  return lines.flatMap((line) => {
    let prompt: string;
    try {
      prompt = promptFromJson(JSON.parse(line) as unknown) ?? line;
    } catch {
      prompt = line;
    }
    return prompt ? [prompt] : [];
  });
}

export function formatDatasetPromptsForEditor(prompts: string[]): string {
  return prompts
    .map((prompt) =>
      /[\r\n]/.test(prompt) ? JSON.stringify({ prompt: prompt.replace(/\r\n/g, "\n") }) : prompt
    )
    .join("\n");
}
