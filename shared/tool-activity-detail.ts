export type ToolActivityPhase = "start" | "result" | "error" | "blocked";

interface PlanItemDetail {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function normalizePlanStatus(value: unknown): PlanItemDetail["status"] {
  if (value === "completed" || value === "in_progress") return value;
  return "pending";
}

function planItemsFrom(value: unknown): PlanItemDetail[] {
  if (!Array.isArray(value)) return [];
  const items: PlanItemDetail[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const content = readString(candidate, ["content", "step", "task"]);
    if (!content) continue;
    items.push({ content, status: normalizePlanStatus(candidate.status) });
  }
  return items;
}

function resolvePlanItems(
  args: Record<string, unknown>,
  result: unknown,
): PlanItemDetail[] {
  if (isRecord(result)) {
    const resultItems = planItemsFrom(result.items);
    if (resultItems.length > 0 || Array.isArray(result.items))
      return resultItems;
  }
  return planItemsFrom(args.items);
}

function formatPlanSummary(
  items: PlanItemDetail[],
  phase: ToolActivityPhase,
): string {
  if (phase === "blocked") return "Plan update blocked";
  if (phase === "error") return "Plan update failed";
  if (items.length === 0)
    return phase === "start" ? "Updating plan..." : "Cleared plan";

  const completed = items.filter((item) => item.status === "completed");
  const active = items.find((item) => item.status === "in_progress");

  if (phase === "start") {
    if (active) return `Updating plan: ${active.content}`;
    if (completed.length === items.length) return "Completing plan...";
    return `Updating plan (${items.length} items)...`;
  }

  if (completed.length === items.length) {
    if (items.length === 1)
      return `Completed "${items[0]?.content || "plan item"}"`;
    return `Completed all ${items.length} plan items`;
  }
  if (active) {
    return `Updated plan: ${active.content} in progress (${completed.length}/${items.length} complete)`;
  }
  if (completed.length > 0) {
    return `Updated plan: ${completed.length}/${items.length} complete`;
  }
  return `Created plan with ${items.length} item${items.length === 1 ? "" : "s"}`;
}

const HTTP_STATUS_TEXT_PATTERN = /\bHTTP\s+(\d{3})\b/i;
const STATUS_FIELD_PATTERN = /\bstatus(?:\s+code)?(?:\s*[:=]\s*|\s+)(\d{3})\b/i;

function toolErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (!isRecord(error)) return "";
  const parts: string[] = [];
  for (const key of ["error", "message", "detail", "content"]) {
    const value = error[key];
    if (typeof value === "string") parts.push(value);
  }
  return parts.join(" ");
}

export function fetchHttpStatusFromError(error: unknown): string | undefined {
  const text = toolErrorText(error);
  const match = HTTP_STATUS_TEXT_PATTERN.exec(text) ?? STATUS_FIELD_PATTERN.exec(text);
  return match?.[1];
}

export function fetchFailureLabel(
  phase: ToolActivityPhase,
  url: string | undefined,
  error: unknown,
): string {
  const verb = phase === "blocked" ? "Fetch blocked" : "Fetch failed";
  const status = fetchHttpStatusFromError(error);
  const label = status ? `${verb} (${status})` : verb;
  return url ? `${label} for ${url}` : label;
}

export function formatStructuredToolActivityDetail(
  toolName: string,
  args: Record<string, unknown>,
  phase: ToolActivityPhase,
  result?: unknown,
): string | undefined {
  const key = toolName.trim().toLowerCase();

  if (key === "skill_load") {
    const resultName = isRecord(result)
      ? readString(result, ["name"])
      : undefined;
    const name = resultName || readString(args, ["name"]);
    const target = name ? ` ${name} skill` : " skill";
    if (phase === "start") return `Loading${target}...`;
    if (phase === "result") return `Loaded${target}`;
    if (phase === "blocked")
      return name ? `Skill load blocked for ${name}` : "Skill load blocked";
    return name ? `Skill load failed for ${name}` : "Skill load failed";
  }

  if (key === "image") {
    if (phase === "start") return "Viewing an image";
    if (phase === "result") return "Viewed an image";
    if (phase === "blocked") return "Image view blocked";
    return "Image view failed";
  }

  if (key === "todo" || key === "update_plan") {
    return formatPlanSummary(resolvePlanItems(args, result), phase);
  }

  return undefined;
}

function imageSourceName(source: string): string | undefined {
  if (source.startsWith("data:")) return undefined;
  const segments = source
    .replace(/[?#].*$/, "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  return segments[segments.length - 1];
}

function imageActivityDetail(
  args: Record<string, unknown>,
  phase: ToolActivityPhase,
  result?: unknown,
): string | undefined {
  const summary = formatStructuredToolActivityDetail("image", args, phase, result);
  const source = readString(args, ["image", "path", "filePath", "url"]);
  const name = source ? imageSourceName(source) : undefined;
  const prompt = readString(args, ["prompt"]);
  const lines = [
    summary,
    name ? `Image: ${name}` : undefined,
    prompt ? `Prompt: ${prompt}` : undefined,
  ].filter((line): line is string => Boolean(line));
  return lines.length > 1 ? lines.join("\n") : undefined;
}

function commandActivityDetail(
  args: Record<string, unknown>,
  phase: ToolActivityPhase,
): string | undefined {
  const command = readString(args, ["command", "cmd"]);
  if (!command) return undefined;
  const prefix =
    phase === "start"
      ? "Running"
      : phase === "result"
        ? "Ran"
        : phase === "blocked"
          ? "Command blocked"
          : "Command failed";
  return `${prefix} ${command}`;
}

function planActivityDetail(
  args: Record<string, unknown>,
  phase: ToolActivityPhase,
  result?: unknown,
): string | undefined {
  const items = resolvePlanItems(args, result);
  if (items.length === 0) return undefined;
  const summary = formatPlanSummary(items, phase);
  const lines = items.map((item) => {
    const marker =
      item.status === "completed"
        ? "[x]"
        : item.status === "in_progress"
          ? "[~]"
          : "[ ]";
    return `${marker} ${item.content}`;
  });
  return `${summary}\n${lines.join("\n")}`;
}

function expandedToolActivityHead(
  toolName: string,
  args: Record<string, unknown>,
  phase: ToolActivityPhase,
  result?: unknown,
): string | undefined {
  const key = toolName.trim().toLowerCase();
  if (key === "exec" || key === "process" || key === "git") {
    return commandActivityDetail(args, phase);
  }
  if (key === "todo" || key === "update_plan") {
    return planActivityDetail(args, phase, result);
  }
  if (key === "image") {
    return imageActivityDetail(args, phase, result);
  }
  return formatStructuredToolActivityDetail(toolName, args, phase, result);
}

export interface ToolDetailLimits {
  outputChars: number;
  diffChars: number;
  argsChars: number;
}

export const PERSISTED_TOOL_DETAIL_LIMITS: ToolDetailLimits = {
  outputChars: 30_000,
  diffChars: 200_000,
  argsChars: 20_000,
};

export const LIVE_TOOL_DETAIL_LIMITS: ToolDetailLimits = {
  outputChars: 4_000,
  diffChars: 16_000,
  argsChars: 4_000,
};

export const TOOL_OUTPUT_HEADING = "Output:";
export const TOOL_DIFF_HEADING = "Diff:";
export const TOOL_ARGS_HEADING = "Arguments:";

const FILE_CHANGE_TOOLS = new Set(["write", "edit", "apply_patch"]);
const COMMAND_TOOLS = new Set(["exec", "process", "git"]);
const HEAD_ONLY_TOOLS = new Set(["image", "skill_load", "todo", "update_plan"]);
const OUTPUT_TEXT_KEYS = ["output", "stdout", "content", "text", "message", "result", "error"];
const OMITTED_RESULT_KEYS = new Set(["system_reminder", "snapshot"]);
const MAX_SERIALIZED_STRING_CHARS = 4_000;
const MAX_SERIALIZED_ARRAY_ITEMS = 50;
const MAX_SERIALIZED_DEPTH = 6;

function clipMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.floor(maxChars * 0.6);
  const tailChars = maxChars - headChars;
  const omitted = text.length - maxChars;
  return `${text.slice(0, headChars)}\n… ${omitted} characters omitted …\n${text.slice(text.length - tailChars)}`;
}

function clipAtLine(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf("\n", maxChars);
  const kept = text.slice(0, cut > 0 ? cut : maxChars);
  return `${kept}\n… ${text.length - kept.length} more characters omitted`;
}

function compactForSerialization(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) return `[data URL omitted, ${value.length} characters]`;
    return value.length > MAX_SERIALIZED_STRING_CHARS
      ? `${value.slice(0, MAX_SERIALIZED_STRING_CHARS)}… [${value.length - MAX_SERIALIZED_STRING_CHARS} more characters]`
      : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_SERIALIZED_DEPTH) return "[nested value omitted]";
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_SERIALIZED_ARRAY_ITEMS)
      .map((item) => compactForSerialization(item, depth + 1));
    return value.length > MAX_SERIALIZED_ARRAY_ITEMS
      ? [...items, `… ${value.length - MAX_SERIALIZED_ARRAY_ITEMS} more items`]
      : items;
  }
  const compacted: Record<string, unknown> = {};
  for (const [entryKey, entry] of Object.entries(value)) {
    if (OMITTED_RESULT_KEYS.has(entryKey)) continue;
    compacted[entryKey] = compactForSerialization(entry, depth + 1);
  }
  return compacted;
}

function exitCodeSuffix(result: Record<string, unknown>): string {
  const exitCode = result.exitCode;
  return typeof exitCode === "number" && exitCode !== 0 ? `\n[exit code ${exitCode}]` : "";
}

function toolResultOutputText(key: string, result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result === "string") return result.trim() ? result : undefined;
  if (!isRecord(result)) {
    return typeof result === "number" || typeof result === "boolean" ? String(result) : undefined;
  }
  if (COMMAND_TOOLS.has(key) && typeof result.output === "string") {
    const text = `${result.output}${exitCodeSuffix(result)}`;
    return text.trim() ? text : undefined;
  }
  for (const textKey of OUTPUT_TEXT_KEYS) {
    const value = result[textKey];
    if (typeof value === "string" && value.trim()) return value;
  }
  if (Object.keys(result).length === 0) return undefined;
  try {
    return JSON.stringify(compactForSerialization(result, 0), null, 2);
  } catch {
    return undefined;
  }
}

function fileChangeDiffText(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const diffs: string[] = [];
  if (Array.isArray(result.changes)) {
    for (const change of result.changes) {
      if (isRecord(change) && typeof change.diff === "string" && change.diff.trim()) {
        diffs.push(change.diff);
      }
    }
  }
  if (diffs.length === 0 && isRecord(result.change)) {
    const diff = result.change.diff;
    if (typeof diff === "string" && diff.trim()) diffs.push(diff);
  }
  return diffs.length > 0 ? diffs.join("\n") : undefined;
}

function toolActivityBody(
  key: string,
  result: unknown,
  limits: ToolDetailLimits,
): string | undefined {
  if (HEAD_ONLY_TOOLS.has(key)) return undefined;
  if (FILE_CHANGE_TOOLS.has(key)) {
    const diff = fileChangeDiffText(result);
    if (diff) return `${TOOL_DIFF_HEADING}\n${clipAtLine(diff, limits.diffChars)}`;
  }
  const output = toolResultOutputText(key, result);
  if (!output) return undefined;
  return `${TOOL_OUTPUT_HEADING}\n${clipMiddle(output, limits.outputChars)}`;
}

export function formatToolCallArgs(
  args: Record<string, unknown>,
  limits: ToolDetailLimits = PERSISTED_TOOL_DETAIL_LIMITS,
): string | undefined {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return undefined;
  const compacted = compactForSerialization(args, 0);
  let json: string;
  try {
    json = JSON.stringify(compacted, null, 2);
  } catch {
    return undefined;
  }
  if (!json || json === "{}") return undefined;
  return `${TOOL_ARGS_HEADING}\n${clipAtLine(json, limits.argsChars)}`;
}

export function formatExpandedToolActivityDetail(
  toolName: string,
  args: Record<string, unknown>,
  phase: ToolActivityPhase,
  result?: unknown,
  limits: ToolDetailLimits = PERSISTED_TOOL_DETAIL_LIMITS,
): string | undefined {
  const key = toolName.trim().toLowerCase();
  const head = expandedToolActivityHead(toolName, args, phase, result);
  const argSection = HEAD_ONLY_TOOLS.has(key) ? undefined : formatToolCallArgs(args, limits);
  const body = phase === "start" ? undefined : toolActivityBody(key, result, limits);
  const sections = [head, argSection, body].filter(
    (section): section is string => Boolean(section),
  );
  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

export interface ToolActivityDetailParts {
  head: string;
  args?: string;
  output?: string;
  diff?: string;
}

const DETAIL_SECTION_PATTERN = new RegExp(
  `(?:^|\\n\\n)(${TOOL_ARGS_HEADING}|${TOOL_OUTPUT_HEADING}|${TOOL_DIFF_HEADING})\\n`,
  "g",
);

export function splitToolActivityDetail(text: string): ToolActivityDetailParts {
  const pattern = new RegExp(DETAIL_SECTION_PATTERN.source, "g");
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return { head: text };

  const parts: ToolActivityDetailParts = {
    head: text.slice(0, matches[0].index ?? 0),
  };

  matches.forEach((match, index) => {
    const heading = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    const body = text.slice(start, end);
    if (heading === TOOL_ARGS_HEADING) parts.args = body;
    else if (heading === TOOL_DIFF_HEADING) parts.diff = body;
    else parts.output = body;
  });

  return parts;
}
