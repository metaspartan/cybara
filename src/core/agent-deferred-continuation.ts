import type { AgentMessage } from "./agent";
import type { AgentToolCallResult } from "./agent-internals";

const DEFERRED_EXECUTION_PATTERNS = [
  /\bI(?:'m| am)\s+ready\s+to\s+(?:execut(?:e|ing)|implement|write|create|apply|run|finish|proceed|continue|begin|start)\b[\s\S]{0,240}\b(?:when|once|after)\s+you\b[\s\S]{0,120}\b(?:go-ahead|approval|confirm|say so|tell me)\b/i,
  /\b(?:ready|about)\s+to\s+(?:proceed|continue|begin|start)\b[\s\S]{0,240}\b(?:execut(?:e|ing)|implement(?:ing)?|writ(?:e|ing)|creat(?:e|ing)|appl(?:y|ying)|runn?ing)\b[\s\S]{0,120}\b(?:next|now)\b/i,
  /\bI(?:'ll| will)\s+(?:now\s+)?(?:proceed|continue|begin|start|execute|implement|write|create|apply|run)\b[\s\S]{0,180}\b(?:next|now|next turn)\b/i,
  /\b(?:proceed|continue|begin|start|execute|implement|write|create|apply|run)\b[\s\S]{0,160}\bon\s+the\s+next\s+turn\b/i,
  /\b(?:executing|implementing|writing|creating|applying|running)\b[\s\S]{0,120}\bnext\b/i,
  /\b(?:proceeding|continuing|starting|beginning)\s+(?:with\s+)?(?:the\s+)?(?:implementation|execution|migration|work)\s+(?:now|next)\b/i,
  /\bI(?:'ll| will)\s+proceed\s+to\s+(?:build|create|execute|finish|generate|implement|make|save|verify|write|produce)\b/i,
  /\b(?:now\s+)?I(?:'ll| will)\s+(?:now\s+)?(?:build|create|execute|finish|generate|implement|make|plan|save|verify|write|produce)\b/i,
  /\b(?:now\s+)?(?:let me|I need to)\s+(?:proceed|continue|build|finish|generate|implement|execute|create|make|plan|produce|save|verify|write)\b/i,
  /\b(?:let me|I(?:'ll| will)|I need to)\b[\s\S]{0,180}\b(?:build|create|execute|finish|generate|implement|make|produce|save|verify|write)\b/i,
  /\b(?:had I been|if I were)\s+permitted\s+to\s+continue\b/i,
];

const USER_PAUSE_PATTERNS = [
  /\b(?:do not|don't)\s+(?:continue|proceed|implement|make changes?|modify|write)\b/i,
  /\b(?:pause|stop|wait)\s+(?:here|before|after|until)\b/i,
  /\b(?:ask me|wait for (?:my )?(?:approval|confirmation))\s+before\b/i,
  /\b(?:only|just)\s+(?:analyze|audit|inspect|plan|review)\b/i,
  /\binstead\s+of\s+(?:creating|writing|modifying|changing|implementing|building)\b/i,
];

const PLAN_REQUEST_PATTERN =
  /\b(?:bootstrap|create|draft|write|give|provide|propose|outline|design|produce|save)\b[\s\S]{0,120}\b(?:implementation\s+|technical\s+|project\s+|setup\s+)?(?:plan|roadmap|proposal|outline|task list)\b/i;
const PLAN_EXECUTION_PATTERN =
  /\b(?:and|then)\s+(?:implement|build|execute|apply|make|start|do|continue)\b/i;
const ACTION_REQUEST_PATTERN =
  /\b(?:your goal(?:\s+is)?\s+to\s+)?(?:produce|create|write|save|execute|make|update|change|fix|implement|build|generate|apply)\b/i;
const PLAN_RESPONSE_PATTERN = /(?:^|\n)\s*#{0,3}\s*(?:implementation\s+)?plan\b/i;
const PLANNED_ACTION_PATTERN =
  /\b(?:build|create|execute|generate|implement|make|save|verify|write)\b/gi;
const UNFINISHED_ACTION_PATTERN =
  /\b(?:I\s+(?:have not|haven't|did not|didn't)\s+(?:build|create|execute|finish|generate|implement|make|save|verify|write)[\s\S]{0,200}\b(?:yet|so far|at this point)|next steps?\s+(?:would|will|is|are)\s+(?:be\s+)?to\s+(?:build|create|execute|finish|generate|implement|make|save|verify|write))\b/i;
const PREMATURE_CONFIRMATION_PATTERN =
  /\b(?:(?:I(?:'d| would)\s+like\s+to\s+)?confirm(?:ation)?\s+before\s+(?:I\s+)?(?:proceed|continue|generate|write|create|implement)|(?:shall|should)\s+I\s+(?:proceed|continue|generate|write|create|implement)|would\s+you\s+like\s+me\s+to\s+(?:proceed|continue|generate|write|create|implement))\b/i;
const READY_TO_EXECUTE_PATTERN =
  /\bI\s+(?:now\s+)?have\s+enough\s+(?:context|details|information)\s+to\s+(?:build|create|execute|finish|generate|implement|make|produce|save|verify|write)\b[\s\S]{0,40}\bnow\b/i;
const COMPLETION_CLAIM_PATTERN =
  /\b(?:(?:the\s+)?(?:task|work|deliverable|implementation|file|request)\s+(?:is|has been)\s+(?:already\s+)?(?:complete|completed|done|finished)|I(?:'ve| have)\s+(?:completed|created|finished|generated|saved|written))\b/i;
const READ_ONLY_TOOL_NAMES = new Set(["image", "memory_search", "read", "web_fetch", "web_search"]);
const FILE_MUTATION_TOOL_NAMES = new Set(["apply_patch", "edit", "write"]);
const EXPOSED_CREDENTIAL_PATTERNS = [
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAC[a-fA-F0-9]{32}\b/,
  /\bSG\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:gh[opsu]_|sk_(?:live|proj)-|whsec_|auth_token_)[A-Za-z0-9_-]{16,}\b/,
  /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@/,
];
const DELIVERABLE_PATH_PATTERNS = [
  /`((?:output|outputs|artifacts?)\/[\w./-]+\.[A-Za-z0-9]{1,10})`/gi,
  /\b(?:file|artifact)\s+(?:called|named)\s+`([^`\n]+)`/gi,
  /\b(?:save|write|create|generate|produce|materialize)\b[^.\n]{0,100}\b(?:to|at|as|into)\s+`([^`\n]+)`/gi,
  /\b(?:save|write|create|generate|produce|materialize)\s+`([^`\n]+)`/gi,
  /\b(?:output|deliverable|target)\s+(?:file|path)?\s*(?:is|:)\s*`([^`\n]+)`/gi,
  /\b(?:save|write|create|generate|produce|materialize)\s+((?:\.{0,2}\/)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,10})\b/gi,
];
const EXTENDED_EVIDENCE_PATTERNS = [
  /\btranscript\b/i,
  /\b(?:extract|identify|list|summarize)\s+all\b/i,
  /\bexhaustive(?:ly)?\b/i,
  /\broot cause\b/i,
  /\bfigure out\b[^\n]{0,80}\b(?:going on|wrong|failed|failing|stopped)\b/i,
  /\b(?:meeting|hearing)\s+(?:minutes|notes|record)\b/i,
  /(?:会议记录|逐字稿|听证记录|根本原因|根因|逐项|全部[^\n]{0,20}(?:提取|总结|列出))/i,
];
const DELIVERABLE_INSPECTION_PATTERNS = [
  /\b(?:analy[sz]e|audit|check|diagnose|inspect|investigate|read|review)\b/i,
  /\b(?:figure out|look at|look into)\b/i,
  /\b(?:current|existing)\s+(?:index|state|status|configuration|config|implementation)\b/i,
  /(?:分析|审计|查看|检查|诊断|调查|读取|根因|当前状态|现有配置)/i,
];
const INITIAL_INSPECTION_TOOL_NAMES = new Set([
  "exec",
  "image",
  "memory_search",
  "read",
  "web_fetch",
  "web_search",
]);

function execCallIsReadOnly(toolCall: AgentToolCallResult): boolean {
  if (!toolCall.args || typeof toolCall.args !== "object") return false;
  const command = (toolCall.args as Record<string, unknown>).command;
  if (typeof command !== "string") return false;
  if (/[>|;&`]|\$\(/.test(command)) return false;
  return /^\s*(?:cat|file|grep|head|ls|pwd|rg|stat|tail|wc)\b/.test(command);
}

function toolCallCanMutate(toolCall: AgentToolCallResult): boolean {
  if (READ_ONLY_TOOL_NAMES.has(toolCall.name)) return false;
  if (toolCall.name === "exec") return !execCallIsReadOnly(toolCall);
  return true;
}

export function requestedDeliverablePaths(content: string): string[] {
  const paths = new Set<string>();
  for (const pattern of DELIVERABLE_PATH_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const matchedPath = match[1]?.trim();
      const path = matchedPath?.replace(/^\.\/workspace\//, "").replace(/^workspace\//, "");
      if (path && !path.includes("://")) paths.add(path);
    }
  }
  return [...paths];
}

export function requestedDeliverablePathsFromMessages(
  messages: Array<{ role?: unknown; content?: unknown }>
): string[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user" || typeof message.content !== "string") continue;
    const paths = requestedDeliverablePaths(message.content);
    if (paths.length > 0) return paths;
  }
  return [];
}

export function requestedDeliverableNeedsExtendedEvidence(
  messages: Array<{ role?: unknown; content?: unknown }>
): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      typeof message.content === "string" &&
      EXTENDED_EVIDENCE_PATTERNS.some((pattern) => pattern.test(message.content as string))
  );
}

export function requestedDeliverableNeedsInspection(
  messages: Array<{ role?: unknown; content?: unknown }>
): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      typeof message.content === "string" &&
      DELIVERABLE_INSPECTION_PATTERNS.some((pattern) => pattern.test(message.content as string))
  );
}

export function toolsForInitialDeliverableInspection<T extends { name: string }>(
  tools: T[],
  inspectionRequired: boolean
): T[] {
  if (!inspectionRequired) return tools;
  const inspectionTools = tools.filter((tool) => INITIAL_INSPECTION_TOOL_NAMES.has(tool.name));
  return inspectionTools.length > 0 ? inspectionTools : tools;
}

export function toolsForDeferredDeliverable<T extends { name: string }>(
  tools: T[],
  continuationAttempt: number,
  requestedPaths: string[]
): T[] {
  if (continuationAttempt === 0 || requestedPaths.length === 0) return tools;
  const mutationTools = tools.filter((tool) => FILE_MUTATION_TOOL_NAMES.has(tool.name));
  return mutationTools.length > 0 ? mutationTools : tools;
}

function execCallProducedPath(toolCall: AgentToolCallResult, path: string): boolean {
  if (!toolCall.args || typeof toolCall.args !== "object") return false;
  const command = (toolCall.args as Record<string, unknown>).command;
  if (typeof command !== "string") return false;
  const result =
    toolCall.result && typeof toolCall.result === "object"
      ? (toolCall.result as Record<string, unknown>)
      : {};
  const exitCode = result.exitCode ?? result.exit_code;
  const succeeded = exitCode === 0 || result.success === true;
  if (
    succeeded &&
    /\b(?:bun|node|python3?)\s+\S*(?:build|create|gen(?:erate)?|render)\S*/i.test(command)
  ) {
    return true;
  }
  if (!command.includes(path)) return false;
  return (
    /(?:^|\s)(?:cp|install|mkdir|mv|tee|touch)\b/.test(command) ||
    /(?:^|[^\d])>{1,2}\s*[^&]/.test(command) ||
    /\b(?:Bun\.write|writeFile|write_text|open\s*\([^)]*,\s*["']w|\.save\s*\()/.test(command)
  );
}

export function toolCallProducedPath(toolCall: AgentToolCallResult, path: string): boolean {
  if (!toolCall.args || typeof toolCall.args !== "object") return false;
  if (toolCallContainsPlaceholder(toolCall)) return false;
  if (toolCall.result === undefined) return false;
  if (toolCall.result && typeof toolCall.result === "object") {
    const result = toolCall.result as Record<string, unknown>;
    if (result.success === false || typeof result.error === "string") return false;
  }
  const args = toolCall.args as Record<string, unknown>;
  const content = typeof args.content === "string" ? args.content : "";
  if (
    path.toLowerCase().endsWith(".md") &&
    /^\s*(?:import\s+\w|from\s+\S+\s+import\s+|def\s+\w+\s*\()/m.test(content) &&
    !content.includes("```")
  ) {
    return false;
  }
  const serialized = JSON.stringify(toolCall.args);
  if (FILE_MUTATION_TOOL_NAMES.has(toolCall.name)) return serialized.includes(path);
  return toolCall.name === "exec" && execCallProducedPath(toolCall, path);
}

export function toolCallContainsPlaceholder(toolCall: Pick<AgentToolCallResult, "args">): boolean {
  const serialized = JSON.stringify(toolCall.args ?? {});
  const values =
    toolCall.args && typeof toolCall.args === "object"
      ? Object.values(toolCall.args as Record<string, unknown>).filter(
          (value): value is string => typeof value === "string"
        )
      : [];
  return (
    /\b(?:placeholder|todo|tbd|pending|in progress|being (?:populated|completed|filled|updated)|complete[sd]? later|next (?:revision|update|pass|iteration)|will be (?:added|completed|expanded)|could not be (?:completed|extracted|finished|read|verified)|could not (?:access|inspect|open|read)|should be (?:completed|regenerated|rewritten|updated)|remaining[^\n]{0,80}(?:continue|follow|pending)|entries? (?:to be|will be) numbered|identified so far|sandbox[^\n]{0,80}refused|without (?:file |read )?access)\b|占位|分析[^\n]{0,8}中|待填|稍后[^\n]{0,20}(?:更新|完成)|待[^\n]{0,20}(?:更新|完成|分析)/i.test(
      serialized
    ) ||
    values.some(
      (value) =>
        /<(?:svg|body|main|section)\b[^>]*>\s*<\/(?:svg|body|main|section)>/i.test(value) ||
        (value.trim().length < 240 &&
          /\b(?:report|file|artifact|content)\b[^\n]{0,80}\b(?:complete|completed|ready|saved)\b[^\n]{0,80}\b(?:see|at|in)\b/i.test(
            value
          ))
    )
  );
}

export function toolCallContainsExposedCredential(
  toolCall: Pick<AgentToolCallResult, "args">
): boolean {
  if (!toolCall.args || typeof toolCall.args !== "object") return false;
  const args = toolCall.args as Record<string, unknown>;
  const candidateFields = ["content", "newText", "new_string", "replacement"];
  return candidateFields.some((field) => {
    const value = args[field];
    return (
      typeof value === "string" &&
      EXPOSED_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value))
    );
  });
}

export function redactExposedCredentials(content: string): string {
  let redacted = content;
  for (const pattern of EXPOSED_CREDENTIAL_PATTERNS) {
    redacted = redacted.replace(new RegExp(pattern.source, "g"), (value) => {
      if (value.startsWith("postgres")) {
        return value.replace(/(:)[^:@/]+(@)$/, "$1[REDACTED]$2");
      }
      return value.length > 10 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "[REDACTED]";
    });
  }
  return redacted.replace(
    /\b(password|secret|token)\s*([:=]|\bis\b)\s*(["'`]?)([^\s"'`]{8,})\3/gi,
    (_match, label: string, separator: string) => `${label} ${separator} [REDACTED]`
  );
}

function missingRequestedDeliverable(
  userContent: string,
  toolCalls: AgentToolCallResult[]
): boolean {
  const paths = requestedDeliverablePaths(userContent);
  return (
    paths.length > 0 &&
    paths.some((path) => !toolCalls.some((toolCall) => toolCallProducedPath(toolCall, path)))
  );
}

export const DEFERRED_EXECUTION_CONTINUATION_PROMPT =
  "Continue the requested task now. Do not stop at a plan or promise another turn. Do not repeat completed inspection or restate the plan. Act directly, keep reasoning and tool calls focused, finish and verify the required deliverables, then return the concrete result or a specific blocker.";

function latestUserContent(messages: AgentMessage[]): string {
  return (
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "user" &&
          message.content.trim() !== DEFERRED_EXECUTION_CONTINUATION_PROMPT
      )
      ?.content.trim() || ""
  );
}

export function shouldContinueDeferredExecution(
  messages: AgentMessage[],
  content: string,
  toolCalls: AgentToolCallResult[] | undefined
): boolean {
  if (!toolCalls?.length || !content.trim()) return false;
  const userContent = latestUserContent(messages);
  if (!userContent) return false;
  if (USER_PAUSE_PATTERNS.some((pattern) => pattern.test(userContent))) return false;
  if (PLAN_REQUEST_PATTERN.test(userContent) && !PLAN_EXECUTION_PATTERN.test(userContent)) {
    return false;
  }
  if (DEFERRED_EXECUTION_PATTERNS.some((pattern) => pattern.test(content))) return true;
  if (
    ACTION_REQUEST_PATTERN.test(userContent) &&
    (PREMATURE_CONFIRMATION_PATTERN.test(content) || READY_TO_EXECUTE_PATTERN.test(content))
  ) {
    return true;
  }
  if (
    ACTION_REQUEST_PATTERN.test(userContent) &&
    COMPLETION_CLAIM_PATTERN.test(content) &&
    !toolCalls.some(toolCallCanMutate)
  ) {
    return true;
  }
  if (missingRequestedDeliverable(userContent, toolCalls)) {
    return true;
  }
  const plannedActionCount = content.match(PLANNED_ACTION_PATTERN)?.length || 0;
  return (
    ACTION_REQUEST_PATTERN.test(userContent) &&
    ((PLAN_RESPONSE_PATTERN.test(content) && plannedActionCount >= 2) ||
      UNFINISHED_ACTION_PATTERN.test(content))
  );
}
