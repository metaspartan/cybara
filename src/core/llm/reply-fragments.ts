const FRAGMENT_TERMINATORS = /[.!?:;)\]}`*_>|"']\s*$/;
const STANDALONE_ANSWER_PATTERN =
  /^(?:task\s+)?(?:complete|completed|done|finished|fixed|implemented|resolved|ok|okay|ready|success|succeeded|yes|no|none|true|false|n\/a)[.!]*$/i;
const NUMERIC_ANSWER_PATTERN = /^[-+$€£%\d.,:/ ]+$/;
const TERSE_REQUEST_PATTERN =
  /\b(?:only|exactly|just|verbatim|one\s+word|single\s+word|a\s+number|the\s+number|yes\s+or\s+no)\b/i;

export function isTruncatedReplyFragment(content: string): boolean {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return true;
  if (STANDALONE_ANSWER_PATTERN.test(trimmed) || NUMERIC_ANSWER_PATTERN.test(trimmed)) return false;
  const words = trimmed.split(" ").length;
  if (words > 3) return false;
  return trimmed.length < 8 || !FRAGMENT_TERMINATORS.test(trimmed);
}

export function requestsTerseReply(userMessage: string): boolean {
  return TERSE_REQUEST_PATTERN.test(userMessage);
}
