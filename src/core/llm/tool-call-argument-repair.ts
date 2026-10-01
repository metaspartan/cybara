const PYTHON_JSON_DECODE_FINGERPRINTS = [
  "expecting value",
  "expecting property name enclosed in double quotes",
  "expecting ',' delimiter",
  "expecting ':' delimiter",
  "expecting double-quoted property name",
  "unterminated string starting at",
  "invalid \\escape",
  "invalid control character",
  "extra data",
];

const UNQUOTED_JSON_LITERALS: Record<string, string> = {
  true: "true",
  false: "false",
  null: "null",
  none: "null",
  True: "true",
  False: "false",
  None: "null",
  NaN: "null",
  Infinity: "null",
  "-Infinity": "null",
  undefined: "null",
};

const SMART_DOUBLE_QUOTES: Record<string, string> = {
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u201F": '"',
  "\u2033": '"',
  "\u00AB": '"',
  "\u00BB": '"',
};

const SMART_SINGLE_QUOTES: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u2032": "'",
  "\u2039": "'",
  "\u203A": "'",
};

function isCloseDelimiter(char: string): boolean {
  return char === "}" || char === "]";
}

type QuoteState = "outside" | "double" | "single";

function normalizeQuotes(text: string): string {
  let out = "";
  let state: QuoteState = "outside";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;

    if (state === "double") {
      if (char === "\\") {
        out += char + (text[index + 1] ?? "");
        index += 1;
        continue;
      }
      if (char === '"' || SMART_DOUBLE_QUOTES[char]) {
        state = "outside";
        out += '"';
        continue;
      }
      out += char;
      continue;
    }

    if (state === "single") {
      if (char === "\\") {
        const next = text[index + 1] ?? "";
        if (next === "'" || next === '"') {
          out += next;
          index += 1;
          continue;
        }
        out += char + next;
        index += 1;
        continue;
      }
      if (char === "'" || SMART_SINGLE_QUOTES[char]) {
        out += '"';
        state = "outside";
        continue;
      }
      if (char === '"') {
        out += '\\"';
        continue;
      }
      out += char;
      continue;
    }

    if (char === '"') {
      state = "double";
      out += char;
      continue;
    }
    if (char === "'" || SMART_SINGLE_QUOTES[char]) {
      state = "single";
      out += '"';
      continue;
    }
    if (SMART_DOUBLE_QUOTES[char]) {
      state = "double";
      out += '"';
      continue;
    }
    out += char;
  }

  return out;
}

function replaceBareLiterals(text: string): string {
  return text.replace(
    /(^|[\s,[\]{}:])(-?\d*\.\d+|-?\d+|true|false|null|none|True|False|None|NaN|Infinity|undefined)(?=\s*[,}\]:]|$)/g,
    (match, prefix: string, token: string) => {
      const mapped = UNQUOTED_JSON_LITERALS[token];
      if (mapped) return `${prefix}${mapped}`;
      return match;
    }
  );
}

function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, "$1");
}

function quoteBareKeys(text: string): string {
  let out = "";
  let state: QuoteState = "outside";
  let expectKeyPosition = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;

    if (state === "double" || state === "single") {
      if (char === "\\") {
        out += char + (text[index + 1] ?? "");
        index += 1;
        continue;
      }
      if (state === "double" && char === '"') state = "outside";
      if (state === "single" && char === "'") state = "outside";
      out += char;
      continue;
    }

    if (char === '"') {
      state = "double";
      expectKeyPosition = false;
      out += char;
      continue;
    }
    if (char === "'" || SMART_SINGLE_QUOTES[char]) {
      state = "single";
      expectKeyPosition = false;
      out += char;
      continue;
    }
    if (char === "{") {
      expectKeyPosition = true;
      out += char;
      continue;
    }
    if (isCloseDelimiter(char)) {
      expectKeyPosition = false;
      out += char;
      continue;
    }
    if (/\s/.test(char) || char === ",") {
      out += char;
      continue;
    }
    if (char === ":") {
      expectKeyPosition = false;
      out += char;
      continue;
    }

    if (expectKeyPosition && /[A-Za-z0-9_$-]/.test(char)) {
      let end = index;
      while (end < text.length && /[A-Za-z0-9_$-]/.test(text[end] as string)) end += 1;
      out += `"${text.slice(index, end)}"`;
      index = end - 1;
      expectKeyPosition = false;
      continue;
    }

    expectKeyPosition = false;
    out += char;
  }

  return out;
}

export function repairJsonLikeText(raw: string): string {
  return stripTrailingCommas(replaceBareLiterals(quoteBareKeys(normalizeQuotes(raw))));
}

export function parseToolCallArguments(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;

  const text = String(raw).trim();
  if (!text) return {};

  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    for (const candidate of [
      repairJsonLikeText(text),
      repairJsonLikeText(text).replace(/'/g, '"'),
    ]) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

export function serializeToolCallArguments(raw: unknown): string {
  const parsed = parseToolCallArguments(raw);
  if (parsed) return JSON.stringify(parsed);
  if (typeof raw === "string" && raw.trim()) {
    try {
      JSON.parse(raw.trim());
    } catch {
      return JSON.stringify({});
    }
  }
  return JSON.stringify({});
}

export function isUpstreamJsonDecodeError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return PYTHON_JSON_DECODE_FINGERPRINTS.some((fingerprint) => lower.includes(fingerprint));
}

export function describesMissingToolCallArguments(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  if (!lower.includes("field required")) return false;
  return lower.includes("arguments");
}
