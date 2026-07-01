const INVISIBLE_CHARS = new RegExp(
  "[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u206A-\\u206F\\uFEFF\\u00AD]",
  "g"
);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "g");

export function sanitizeMemoryContent(text: string): string {
  if (typeof text !== "string") return "";
  return text.replace(INVISIBLE_CHARS, "").replace(CONTROL_CHARS, "");
}
