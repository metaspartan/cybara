export interface ProcessActivityInfo {
  id: string;
  phase: "start" | "result" | "error" | "blocked";
  text: string;
  timestamp: number;
  toolName?: string;
  toolCallId?: string;
  sandboxProvider?: string;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "pending" | "executing" | "completed" | "failed";
  result?: unknown;
  error?: string;
  duration?: number;
  timeline_index?: number;
}

function readToolArgString(
  args: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!args) return undefined;
  const value = args[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toActivityDisplayPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) return "file";
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || normalized;
}

function isGenericProcessLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "thinking..." ||
    normalized === "thinking" ||
    normalized === "generating response..." ||
    normalized === "generating response" ||
    normalized === "working..." ||
    normalized === "working" ||
    normalized === "idle"
  );
}

function isMeaningfulProcessThought(value?: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !isGenericProcessLabel(trimmed);
}

function normalizeProcessActivityTextForPhase(
  value: string,
  phase: ProcessActivityInfo["phase"]
): string {
  if (phase === "start") return value;
  if (phase === "result") {
    return value
      .replace(/^Exploring\b/i, "Explored")
      .replace(/^Searching\b/i, "Searched")
      .replace(/^Fetching\b/i, "Fetched")
      .replace(/^Running\b/i, "Ran")
      .replace(/^Writing\b/i, "Edited")
      .replace(/^Editing\b/i, "Edited");
  }
  if (phase === "blocked") {
    return value
      .replace(/^Exploring\b/i, "Read blocked")
      .replace(/^Searching\b/i, "Search blocked")
      .replace(/^Fetching\b/i, "Fetch blocked")
      .replace(/^Running\b/i, "Command blocked")
      .replace(/^Writing\b/i, "Edit blocked")
      .replace(/^Editing\b/i, "Edit blocked");
  }
  return value
    .replace(/^Exploring\b/i, "Read failed")
    .replace(/^Searching\b/i, "Search failed")
    .replace(/^Fetching\b/i, "Fetch failed")
    .replace(/^Running\b/i, "Command failed")
    .replace(/^Writing\b/i, "Edit failed")
    .replace(/^Editing\b/i, "Edit failed");
}

export function formatProcessActivityFromToolCall(toolCall: ToolCallInfo): string {
  const key = toolCall.name.toLowerCase();
  const args = toolCall.args || {};
  const path = readToolArgString(args, "path");
  const displayPath = path ? toActivityDisplayPath(path) : undefined;

  if (key === "read") {
    return displayPath ? `Explored ${displayPath}` : "Exploration complete";
  }
  if (key === "write" || key === "edit") {
    return displayPath ? `Edited ${displayPath}` : "Edit complete";
  }
  if (key === "file_search" || key === "grep") {
    const pattern = readToolArgString(args, "pattern");
    return pattern ? `Search complete for "${pattern}"` : "Search complete";
  }
  if (key === "web_search") {
    const query = readToolArgString(args, "query");
    return query ? `Web search complete for "${query}"` : "Web search complete";
  }
  if (key === "web_fetch") {
    const url = readToolArgString(args, "url");
    return url ? `Fetched ${url}` : "Fetch complete";
  }
  if (key === "exec" || key === "process" || key === "git") {
    const command = readToolArgString(args, "command") || readToolArgString(args, "cmd");
    if (command) {
      const compact = command
        .split(/\r?\n/)
        .map((line) => line.trim())
        .join(" ")
        .trim();
      if (compact.length > 0) return `Ran ${compact}`;
    }
    return "Command complete";
  }
  if (key === "browser") {
    const action = readToolArgString(args, "action");
    return action ? `Browser ${action} complete` : "Browser action complete";
  }
  if (key === "artifacts" || key === "artifact") {
    const action = (readToolArgString(args, "action") || "list").toLowerCase();
    const name =
      readToolArgString(args, "name") ||
      readToolArgString(args, "artifact") ||
      readToolArgString(args, "artifactName") ||
      readToolArgString(args, "fileName");
    if (action === "list") return "Listed session artifacts";
    if (action === "create") {
      return name
        ? `Created ${name.endsWith(".md.resolved") ? name : `${name}.md.resolved`}`
        : "Created artifact";
    }
    if (action === "update" || action === "append") {
      return name
        ? `Updated ${name.endsWith(".md.resolved") ? name : `${name}.md.resolved`}`
        : "Updated artifact";
    }
    if (action === "read") {
      return name
        ? `Read ${name.endsWith(".md.resolved") ? name : `${name}.md.resolved`}`
        : "Read artifact";
    }
    return name ? `Artifact ${action} complete for ${name}` : `Artifact ${action} complete`;
  }

  return `${toolCall.name} complete`;
}

function extractSandboxProviderFromToolCall(toolCall: ToolCallInfo): string | undefined {
  const normalized = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim().toLowerCase();
    if (
      trimmed === "apple_sandbox" ||
      trimmed === "podman" ||
      trimmed === "docker" ||
      trimmed === "host"
    ) {
      return trimmed;
    }
    return undefined;
  };

  const result = toolCall.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const typed = result as Record<string, unknown>;
  return normalized(typed.sandboxProvider ?? typed.sandbox_provider);
}

export function dedupeProcessActivities(activities: ProcessActivityInfo[]): ProcessActivityInfo[] {
  const seen = new Set<string>();
  const deduped: ProcessActivityInfo[] = [];
  const normalizedActivities = activities
    .map((activity) => ({
      ...activity,
      text: normalizeProcessActivityTextForPhase(activity.text.trim(), activity.phase),
    }))
    .filter((activity) => activity.text.length > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  const latestCompletionByToolCallId = new Map<string, number>();
  for (const activity of normalizedActivities) {
    if (activity.phase === "start" || typeof activity.toolCallId !== "string") continue;
    const toolCallIdKey = activity.toolCallId.trim().toLowerCase();
    if (!toolCallIdKey) continue;
    const latestCompletion = latestCompletionByToolCallId.get(toolCallIdKey);
    if (latestCompletion === undefined || activity.timestamp > latestCompletion) {
      latestCompletionByToolCallId.set(toolCallIdKey, activity.timestamp);
    }
  }
  const hasCompletionForStart = (activity: ProcessActivityInfo): boolean => {
    if (activity.phase !== "start") return false;
    const toolCallIdKey =
      typeof activity.toolCallId === "string" && activity.toolCallId.trim()
        ? activity.toolCallId.trim().toLowerCase()
        : "";
    if (!toolCallIdKey) return false;
    const latestCompletion = latestCompletionByToolCallId.get(toolCallIdKey);
    return latestCompletion !== undefined && latestCompletion >= activity.timestamp;
  };

  for (const activity of normalizedActivities) {
    if (hasCompletionForStart(activity)) continue;
    const normalizedText = activity.text;
    if (!normalizedText) continue;
    const toolCallIdKey =
      typeof activity.toolCallId === "string" && activity.toolCallId.trim()
        ? activity.toolCallId.trim().toLowerCase()
        : "";
    const key = toolCallIdKey
      ? `${activity.phase}:${toolCallIdKey}`
      : `${activity.phase}:${(activity.toolName || "").toLowerCase()}:${normalizedText.toLowerCase()}:${Math.floor(activity.timestamp / 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...activity, text: normalizedText });
  }
  return deduped;
}

export function buildFallbackProcessActivities(
  toolCalls: ToolCallInfo[],
  thinking: string | undefined,
  baseTimestampMs: number
): ProcessActivityInfo[] | undefined {
  const activities: ProcessActivityInfo[] = [];
  const fallbackStart = Number.isFinite(baseTimestampMs) ? baseTimestampMs : Date.now();

  for (let index = 0; index < toolCalls.length; index += 1) {
    const toolCall = toolCalls[index];
    const phase: ProcessActivityInfo["phase"] =
      toolCall.status === "failed" ? "error" : toolCall.status === "executing" ? "start" : "result";
    const timelineOffset =
      typeof toolCall.timeline_index === "number" && Number.isFinite(toolCall.timeline_index)
        ? toolCall.timeline_index
        : index;
    activities.push({
      id: `fallback-${toolCall.id || index}`,
      phase,
      text: formatProcessActivityFromToolCall(toolCall),
      timestamp: fallbackStart + timelineOffset,
      toolName: toolCall.name,
      toolCallId: typeof toolCall.id === "string" && toolCall.id.trim() ? toolCall.id : undefined,
      sandboxProvider: extractSandboxProviderFromToolCall(toolCall),
    });
  }

  if (isMeaningfulProcessThought(thinking)) {
    const thoughtLines = (thinking || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !isGenericProcessLabel(line));
    for (let index = 0; index < thoughtLines.length; index += 1) {
      activities.push({
        id: `fallback-thought-${index}`,
        phase: "result",
        text: thoughtLines[index],
        timestamp: fallbackStart + toolCalls.length + index + 1,
        toolName: "__thought",
      });
    }
  }

  const deduped = dedupeProcessActivities(activities);
  return deduped.length > 0 ? deduped : undefined;
}
