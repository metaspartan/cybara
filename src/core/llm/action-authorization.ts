export const ACTION_AUTHORIZATION_INSTRUCTION =
  "You have the user's explicit go-ahead to act on this request. Do not stop to ask permission, " +
  "present a plan awaiting approval, or end with 'want me to...' / 'say the word'. Execute the " +
  "requested work directly with tools, run checks, and deliver results. Continue until the work " +
  "is done or you are concretely blocked; if blocked, report exactly what blocked you and what " +
  "you tried.";

const DIRECTIVE_PATTERNS = [
  /\bcontinue\b/i,
  /\bproceed\b/i,
  /\bgo ahead\b/i,
  /\bkeep (going|working|pushing|improving|moving)\b/i,
  /\bpush (forward|the frontier|it|ahead)\b/i,
  /\bget .{0,60}\b(in|done|submitted|shipped|landed)\b/i,
  /\bact on it\b/i,
  /\bdo it\b/i,
  /\btake action\b/i,
  /\b(start|begin) (working|work|on)\b/i,
  /\b(make|get) it (happen|work|done|real)\b/i,
  /\bfix (this|it|the)\b/i,
  /\bimplement (this|it|the)\b/i,
  /\bimprove (this|it|the|further)\b/i,
  /\bsubmit\b/i,
  /\bexecute\b/i,
  /\bfinish (this|it|the)\b/i,
  /\bcomplete (this|it|the)\b/i,
  /\bpush the frontier\b/i,
];

const DIRECTIVE_STARTS = [
  /^(yea|yeah|yes|yep|ok|okay|oke?y|go|sounds? good|approved|greenlight|please|do it|let'?s go|let'?s)\b/i,
  /^continue\b/i,
  /^keep\b/i,
];

const DISCUSSION_EXCLUDES = [
  /^should i\b/i,
  /^do you think\b/i,
  /^is it (a )?good idea\b/i,
  /^what do you think\b/i,
  /^what if\b/i,
  /^can we (talk|discuss)\b/i,
  /^let'?s discuss\b/i,
  /^how do i\b/i,
  /^could you (explain|walk)/i,
  /^what'?s the (best|difference|point)\b/i,
  /^why (did|is|does)\b/i,
];

function isDiscussionMessage(message: string): boolean {
  return DISCUSSION_EXCLUDES.some((pattern) => pattern.test(message));
}

function isGoalIterationMessage(message: string): boolean {
  return message.trimStart().startsWith("[autonomous goal iteration");
}

export function resolveActionAuthorizationInstruction(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (isGoalIterationMessage(trimmed)) return null;
  if (isDiscussionMessage(trimmed)) return null;

  const startsDirective = DIRECTIVE_STARTS.some((pattern) => pattern.test(trimmed));
  const containsDirective = DIRECTIVE_PATTERNS.some((pattern) => pattern.test(trimmed));
  if (!startsDirective && !containsDirective) return null;

  return ACTION_AUTHORIZATION_INSTRUCTION;
}
