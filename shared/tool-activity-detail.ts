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

  if (key === "todo" || key === "update_plan") {
    return formatPlanSummary(resolvePlanItems(args, result), phase);
  }

  return undefined;
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

export function formatExpandedToolActivityDetail(
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
  return formatStructuredToolActivityDetail(toolName, args, phase, result);
}
