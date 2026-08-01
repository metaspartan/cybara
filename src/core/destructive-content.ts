export const ROOT_DESTRUCTIVE_COMMAND_PATTERNS: readonly RegExp[] = [
  /\b(?:sudo\s+)?rm\s+-(?=[a-z]*r)(?=[a-z]*f)[a-z]+\s+\/(?=$|[\s`'"\)\]\}.,;:])/i,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/i,
];

export function containsRootDestructiveCommand(text: string): boolean {
  return ROOT_DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(text));
}

export function redactRootDestructiveCommands(text: string): {
  content: string;
  redactions: number;
} {
  let redactions = 0;
  const content = ROOT_DESTRUCTIVE_COMMAND_PATTERNS.reduce((current, pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return current.replace(new RegExp(pattern.source, flags), () => {
      redactions += 1;
      return "[redacted destructive command]";
    });
  }, text);
  return { content, redactions };
}
