export type SharedActivityPhase = "start" | "result" | "error" | "blocked";

export interface SharedActivityItem {
  id: string;
  phase: SharedActivityPhase;
  text: string;
  toolName?: string;
}

export type SharedActivityGroupKind = "read" | "search" | "list" | "edit" | "fetch" | "command";

export interface SharedActivityDisplayGroup<T extends SharedActivityItem> {
  type: "group";
  id: string;
  kind: SharedActivityGroupKind;
  label: string;
  items: T[];
}

export interface SharedActivityDisplaySingle<T extends SharedActivityItem> {
  type: "single";
  activity: T;
}

export type SharedActivityDisplayEntry<T extends SharedActivityItem> =
  | SharedActivityDisplayGroup<T>
  | SharedActivityDisplaySingle<T>;

const TOOL_KINDS: Record<string, SharedActivityGroupKind> = {
  read: "read",
  grep: "search",
  file_search: "search",
  glob: "search",
  web_search: "search",
  ls: "list",
  list: "list",
  write: "edit",
  edit: "edit",
  apply_patch: "edit",
  multi_edit: "edit",
  web_fetch: "fetch",
  fetch: "fetch",
  http_request: "fetch",
};

const COMMAND_KINDS: Record<string, SharedActivityGroupKind> = {
  cat: "read",
  head: "read",
  tail: "read",
  bat: "read",
  less: "read",
  more: "read",
  ls: "list",
  find: "list",
  tree: "list",
  fd: "list",
  dir: "list",
  grep: "search",
  rg: "search",
  ag: "search",
  ack: "search",
  ripgrep: "search",
  wc: "command",
  cloc: "command",
  du: "command",
  stat: "command",
  file: "command",
  which: "command",
  pwd: "command",
  echo: "command",
  env: "command",
  printenv: "command",
  date: "command",
  whoami: "command",
  uname: "command",
  hostname: "command",
  cd: "command",
  pushd: "command",
  popd: "command",
  printf: "command",
  true: "command",
  ":": "command",
};

const COMMAND_WRAPPERS = new Set(["sudo", "command", "time", "nice", "nohup", "env", "xargs"]);
const COMMAND_STAGE_SPLIT = /\s*(?:&&|\|\||\||;|\n)\s*/;

function classifyCommandStage(stage: string): SharedActivityGroupKind {
  const tokens = stage.trim().split(/\s+/);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] || "";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      continue;
    }
    if (index > 0 && token.startsWith("-")) {
      index += 1;
      continue;
    }
    const verb = token.split(/[\\/]/).pop()?.toLowerCase() || "";
    if (COMMAND_WRAPPERS.has(verb) && verb !== "env" && verb !== "xargs") {
      index += 1;
      continue;
    }
    if (
      (verb === "env" || verb === "xargs") &&
      index + 1 < tokens.length &&
      !(tokens[index + 1] || "").startsWith("-")
    ) {
      index += 1;
      continue;
    }
    break;
  }
  const verb = tokens[index]?.split(/[\\/]/).pop()?.toLowerCase() || "";
  if (!verb || verb === "git") return "command";
  return COMMAND_KINDS[verb] ?? "command";
}

function classifyCommand(command: string): SharedActivityGroupKind {
  const stages = command
    .trim()
    .replace(/\s*\.\.\.$/, "")
    .split(COMMAND_STAGE_SPLIT)
    .map((stage) => stage.trim())
    .filter(Boolean);
  const kinds = stages.map(classifyCommandStage);
  return kinds.find((kind) => kind !== "command") ?? "command";
}

export function sharedActivityKind(
  activity: SharedActivityItem,
): SharedActivityGroupKind | null {
  if (activity.phase !== "result") return null;
  const toolName = activity.toolName?.toLowerCase() || "";
  if (toolName in TOOL_KINDS) return TOOL_KINDS[toolName] ?? "command";
  if (toolName === "exec" || toolName === "process" || toolName === "git" || !toolName) {
    const command = activity.text.match(/^Ran\s+(.+)$/s)?.[1];
    if (command) return classifyCommand(command);
    if (!toolName) {
      if (/^Explored /.test(activity.text)) return "read";
      if (/^Searched /.test(activity.text)) return "search";
      if (/^Listed /.test(activity.text)) return "list";
      if (/^(?:Edited|Created|Updated|Wrote|Deleted) /.test(activity.text)) return "edit";
      if (/^Fetched /.test(activity.text)) return "fetch";
    }
  }
  return "command";
}

const PHRASES: Record<
  SharedActivityGroupKind,
  { one: string; many: (count: number) => string }
> = {
  read: { one: "read a file", many: (count) => `read ${count} files` },
  search: { one: "ran a search", many: (count) => `ran ${count} searches` },
  list: { one: "listed a location", many: (count) => `listed ${count} locations` },
  edit: { one: "edited a file", many: (count) => `edited ${count} files` },
  fetch: { one: "fetched a page", many: (count) => `fetched ${count} pages` },
  command: { one: "ran a command", many: (count) => `ran ${count} commands` },
};

function groupLabel(kinds: SharedActivityGroupKind[]): string {
  const counts = new Map<SharedActivityGroupKind, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const label = [...counts.entries()]
    .map(([kind, count]) => (count === 1 ? PHRASES[kind].one : PHRASES[kind].many(count)))
    .join(", ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function dominantKind(kinds: SharedActivityGroupKind[]): SharedActivityGroupKind {
  return (
    (["edit", "fetch", "search", "read", "list", "command"] as const).find((kind) =>
      kinds.includes(kind),
    ) ?? "command"
  );
}

export function groupSharedActivities<T extends SharedActivityItem>(
  activities: T[],
): SharedActivityDisplayEntry<T>[] {
  const entries: SharedActivityDisplayEntry<T>[] = [];
  let run: { kinds: SharedActivityGroupKind[]; items: T[]; trailing: T[] } | null = null;
  const flush = (): void => {
    if (!run) return;
    if (run.kinds.length >= 2) {
      entries.push({
        type: "group",
        id: run.items[0]?.id || "activity-group",
        kind: dominantKind(run.kinds),
        label: groupLabel(run.kinds),
        items: run.items,
      });
    } else {
      for (const activity of run.items) entries.push({ type: "single", activity });
    }
    for (const activity of run.trailing) entries.push({ type: "single", activity });
    run = null;
  };

  for (const activity of activities) {
    if (activity.toolName === "__thought") {
      flush();
      entries.push({ type: "single", activity });
      continue;
    }
    const kind = sharedActivityKind(activity);
    if (kind === null) {
      if (run && activity.phase === "start") {
        run.trailing.push(activity);
        continue;
      }
      flush();
      entries.push({ type: "single", activity });
      continue;
    }
    if (run) {
      run.kinds.push(kind);
      run.items.push(activity);
    } else {
      run = { kinds: [kind], items: [activity], trailing: [] };
    }
  }
  flush();
  return entries;
}
