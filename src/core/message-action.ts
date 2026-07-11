const mutationAction =
  /\b(add|build|change|code|complete|create|delete|develop|edit|finish|fix|implement|make|modify|patch|refactor|remove|repair|scaffold|update|write)\b/;
const mutationTarget =
  /\b(api|app|application|code|component|directory|feature|file|files|folder|page|program|project|repo|repository|roadmap|script|service|site|test|tests|webpage|website|workspace)\b/;
const explanation =
  /\b(explain|describe|estimate|what (?:is|are)|tell me how|how (?:do|can|could|would|should) (?:i|we|you))\b/;
const noMutation =
  /\b(?:do not|don't|dont)\s+(?:change|edit|modify|write)(?:\s+(?:anything|files?|code|the\s+repo(?:sitory)?))?\b|\b(?:no|without)\s+(?:code\s+)?(?:changes?|edits?|modifications?)\b/;

export function isCodeMutationRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized || explanation.test(normalized) || noMutation.test(normalized)) return false;
  return mutationAction.test(normalized) && mutationTarget.test(normalized);
}
