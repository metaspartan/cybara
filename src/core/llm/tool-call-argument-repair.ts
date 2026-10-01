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
  "unexpected end of json input",
  "unexpected end of input",
  "json.loads() failed",
  "json.loads failed",
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

const CONTROL_CHARACTER_ESCAPES: Record<string, string> = {
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

const BARE_VALUE_TOKEN =
  /^-?(?:\d+\.\d+|\d+|true|false|null|none|True|False|None|NaN|Infinity|undefined)$/;

function opensValuePosition(text: string, index: number): boolean {
  for (let probe = index - 1; probe >= 0; probe -= 1) {
    const char = text[probe] as string;
    if (/\s/.test(char)) continue;
    return char === "," || char === "[" || char === "{" || char === ":";
  }
  return true;
}

function closesValuePosition(text: string, index: number): boolean {
  for (let probe = index; probe < text.length; probe += 1) {
    const char = text[probe] as string;
    if (/\s/.test(char)) continue;
    return char === "," || char === "}" || char === "]" || char === ":";
  }
  return true;
}

function rewriteStructureOutsideStrings(text: string): string {
  let out = "";
  let state: QuoteState = "outside";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;

    if (state !== "outside") {
      if (char === "\\") {
        out += char + (text[index + 1] ?? "");
        index += 1;
        continue;
      }
      if ((state === "double" && char === '"') || (state === "single" && char === "'")) {
        state = "outside";
      }
      const escape = CONTROL_CHARACTER_ESCAPES[char];
      out += escape ?? char;
      continue;
    }

    if (char === '"') {
      state = "double";
      out += char;
      continue;
    }
    if (char === "'") {
      state = "single";
      out += char;
      continue;
    }

    if (char === ",") {
      let probe = index + 1;
      while (probe < text.length && /\s/.test(text[probe] as string)) probe += 1;
      const next = text[probe];
      if (next !== "}" && next !== "]") out += char;
      continue;
    }

    if (/[A-Za-z0-9-]/.test(char)) {
      let end = index + 1;
      while (end < text.length && /[A-Za-z0-9._-]/.test(text[end] as string)) end += 1;
      const token = text.slice(index, end);
      const mapped =
        BARE_VALUE_TOKEN.test(token) &&
        opensValuePosition(text, index) &&
        closesValuePosition(text, end)
          ? UNQUOTED_JSON_LITERALS[token]
          : undefined;
      out += mapped ?? token;
      index = end - 1;
      continue;
    }

    out += char;
  }

  return out;
}

function quoteBareKeys(text: string): string {
  let out = "";
  let state: QuoteState = "outside";
  let expectKeyPosition = false;
  const containers: Array<"{" | "["> = [];

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
      containers.push("{");
      expectKeyPosition = true;
      out += char;
      continue;
    }
    if (char === "[") {
      containers.push("[");
      expectKeyPosition = false;
      out += char;
      continue;
    }
    if (isCloseDelimiter(char)) {
      containers.pop();
      expectKeyPosition = false;
      out += char;
      continue;
    }
    if (char === ",") {
      expectKeyPosition = containers[containers.length - 1] === "{";
      out += char;
      continue;
    }
    if (/\s/.test(char)) {
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
  return rewriteStructureOutsideStrings(quoteBareKeys(normalizeQuotes(raw)));
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

export interface UnserializableToolCallArgumentsError extends Error {
  cybaraUnserializableToolCallArguments?: number;
}

export function markUnserializableToolCallArguments(
  error: Error,
  count: number
): UnserializableToolCallArgumentsError {
  const marked = error as UnserializableToolCallArgumentsError;
  if (count > 0) marked.cybaraUnserializableToolCallArguments = count;
  return marked;
}

export function unserializableToolCallArgumentCount(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  const value = (error as UnserializableToolCallArgumentsError)
    .cybaraUnserializableToolCallArguments;
  return typeof value === "number" && value > 0 ? value : 0;
}

export function describesMissingToolCallArguments(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  if (!lower.includes("field required")) return false;
  return lower.includes("arguments");
}
