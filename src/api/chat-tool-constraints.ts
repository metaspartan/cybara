import {
  COMPUTER_USE_ACTION_TOOL_ALIASES,
  COMPUTER_USE_COMPAT_TOOL_ALIASES,
} from "../core/computer-use-actions";

const computerUseToolNames = new Set([
  "computer_use",
  ...COMPUTER_USE_ACTION_TOOL_ALIASES,
  ...Object.keys(COMPUTER_USE_COMPAT_TOOL_ALIASES),
]);

const restrictedToolGroups: Array<{
  pattern: RegExp;
  matches: (name: string) => boolean;
}> = [
  {
    pattern: /\b(?:computer[-_\s]?use|desktop control|control (?:the )?desktop)\b/i,
    matches: (name) => computerUseToolNames.has(name),
  },
  {
    pattern: /\b(?:embedded )?browser(?: tools?| automation)?\b/i,
    matches: (name) => name === "browser",
  },
  {
    pattern: /\b(?:shell commands?|terminal commands?|command line|exec)\b/i,
    matches: (name) => name === "exec" || name === "process",
  },
  {
    pattern: /\bweb search\b/i,
    matches: (name) => name === "web_search" || name === "x_search",
  },
  {
    pattern: /\bweb fetch\b/i,
    matches: (name) => name === "web_fetch",
  },
  {
    pattern: /\bsubagents?\b/i,
    matches: (name) => name === "sessions_spawn",
  },
];

const restrictionClausePattern =
  /\b(?:do not use|don't use|dont use|never use|without using|avoid using)\b([^.!?\n]{1,240})/gi;

const exclusiveToolGroups: Array<{
  pattern: RegExp;
  matches: (name: string) => boolean;
}> = [
  {
    pattern:
      /\b(?:use\s+only\s+(?:the\s+)?(?:embedded\s+)?browser(?:\s+tools?)?|use\s+(?:the\s+)?(?:embedded\s+)?browser(?:\s+tools?)?\s+only)\b/i,
    matches: (name) => name === "browser",
  },
  {
    pattern:
      /\b(?:use\s+only\s+(?:the\s+)?computer[-_\s]?use(?:\s+tools?)?|use\s+(?:the\s+)?computer[-_\s]?use(?:\s+tools?)?\s+only)\b/i,
    matches: (name) => computerUseToolNames.has(name),
  },
];

export function constrainToolsForMessage(
  message: string,
  allowedToolNames: string[]
): string[] | undefined {
  const exclusive = exclusiveToolGroups.find((group) => group.pattern.test(message));
  const candidates = exclusive
    ? allowedToolNames.filter((name) => exclusive.matches(name))
    : allowedToolNames;
  const clauses = [...message.matchAll(restrictionClausePattern)].map((match) => match[1] || "");
  if (clauses.length === 0) return exclusive ? candidates : undefined;
  const denied = restrictedToolGroups.filter((group) =>
    clauses.some((clause) => group.pattern.test(clause))
  );
  if (denied.length === 0) return exclusive ? candidates : undefined;
  return candidates.filter((name) => !denied.some((group) => group.matches(name)));
}
