const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|passwd|authorization|cookie|private[_-]?key|mnemonic|seed)/i;

const PREFIXED_SECRET_PATTERNS: readonly RegExp[] = [
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|passwd|authorization|cookie)\s*[:=]\s*)([^\s,;'"<>]+)/gi,
];

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(cybara(?:_mobile)?_[a-f0-9]{24,})\b/gi,
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\b(xox[baprs]-[A-Za-z0-9-]{16,})\b/g,
];

export function redactSecretText(input: string): string {
  let output = input;
  for (const pattern of PREFIXED_SECRET_PATTERNS) {
    output = output.replace(pattern, "$1[REDACTED]");
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

export function redactSecrets(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8) return "[MaxDepth]";
  if (value == null) return value;
  if (typeof value === "string") return redactSecretText(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((entry) => redactSecrets(entry, depth + 1, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      output[key] =
        SENSITIVE_KEY_PATTERN.test(key) &&
        typeof raw !== "number" &&
        typeof raw !== "boolean" &&
        typeof raw !== "bigint"
          ? "[REDACTED]"
          : redactSecrets(raw, depth + 1, seen);
    }
    return output;
  }
  return redactSecretText(String(value));
}
