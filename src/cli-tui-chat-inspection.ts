function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function compact(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function compactInspectionLines(lines: string[], limit = 8): string {
  if (lines.length <= limit) return lines.join("\n");
  return [...lines.slice(0, limit), `… ${lines.length - limit} more`].join("\n");
}

export function skillStatusLines(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.skills)) return [];
  return value.skills.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string") return [];
    const status =
      item.disabled === true ? "disabled" : item.eligible === true ? "ready" : "blocked";
    return [`${status === "ready" ? "*" : "-"} ${item.name} · ${status}`];
  });
}

export function mcpStatusLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name =
      typeof item.name === "string" ? item.name : typeof item.id === "string" ? item.id : "";
    if (!name) return [];
    const status = typeof item.status === "string" ? item.status : "stopped";
    const toolCount = typeof item.toolCount === "number" ? ` · ${item.toolCount} tools` : "";
    return [`${status === "running" ? "*" : "-"} ${name} · ${status}${toolCount}`];
  });
}

export function memoryStatusLine(status: unknown, memory: unknown): string {
  const statusRecord = isRecord(status) ? status : {};
  const memoryRecord = isRecord(memory) ? memory : {};
  const files = typeof statusRecord.files === "number" ? statusRecord.files : 0;
  const chunks = typeof statusRecord.chunks === "number" ? statusRecord.chunks : 0;
  const memories = Array.isArray(memoryRecord.memories) ? memoryRecord.memories.length : files;
  const provider =
    typeof statusRecord.configuredProvider === "string"
      ? statusRecord.configuredProvider
      : typeof statusRecord.provider === "string"
        ? statusRecord.provider
        : "local";
  return `Memory ${memories} files · ${chunks} indexed chunks · ${provider}`;
}

export function logLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const message = typeof item.message === "string" ? item.message.trim() : "";
    if (!message) return [];
    const level = typeof item.level === "string" ? item.level.toUpperCase() : "INFO";
    const source =
      typeof item.module === "string"
        ? item.module
        : typeof item.source === "string"
          ? item.source
          : "gateway";
    return [`${level.padEnd(5)} ${compact(source, 14)} · ${compact(message, 92)}`];
  });
}
