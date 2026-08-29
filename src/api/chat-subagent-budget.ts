const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

export function resolveExplicitSubagentSpawnLimit(message: string): number | undefined {
  const match = message.match(
    /\bexactly\s+(one|two|three|four|five|six|seven|eight|[1-8])\s+(?:parallel\s+)?(?:child\s+agents?|sub-?agents?)\b/i
  );
  if (!match?.[1]) return undefined;
  const normalized = match[1].toLowerCase();
  return NUMBER_WORDS[normalized] ?? Number(normalized);
}
