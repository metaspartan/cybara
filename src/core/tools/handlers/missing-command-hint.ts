const VERSIONED_ALTERNATIVES: Record<string, string> = {
  python: "python3",
  pip: "pip3",
};

const MISSING_COMMAND_PATTERNS = [
  /(?:^|[\s:])(python|pip)(?::\s*command not found|: not found)/m,
  /command not found: (python|pip)$/m,
];

export function missingCommandHint(
  exitCode: number,
  output: string,
  which: (command: string) => string | null = Bun.which
): string {
  if (exitCode !== 127) return "";
  const missing = MISSING_COMMAND_PATTERNS.map((pattern) => pattern.exec(output)?.[1]).find(
    Boolean
  );
  if (!missing) return "";
  const alternative = VERSIONED_ALTERNATIVES[missing];
  if (!which(alternative)) return "";
  return `\n${missing} is not installed here; use ${alternative} instead.`;
}
