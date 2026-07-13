function decodeSpeechEntity(entity: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  if (entity in named) return named[entity] ?? entity;
  const radix = entity.toLowerCase().startsWith("#x") ? 16 : 10;
  const digits = entity.startsWith("#") ? entity.slice(radix === 16 ? 2 : 1) : "";
  const codePoint = digits ? Number.parseInt(digits, radix) : Number.NaN;
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return `&${entity};`;
  return String.fromCodePoint(codePoint);
}

export function speechTextFromMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/~~~[^\n]*\n?/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/^[ \t]*\[[^\]]+\]:[ \t]+\S+.*$/gm, "")
    .replace(/`+([^`]+?)`+/g, "$1")
    .replace(/(\*\*|__)([^\n]+?)\1/g, "$2")
    .replace(/(~~)([^\n]+?)\1/g, "$2")
    .replace(/(^|[\s(])([*_])([^*_\n]+?)\2(?=$|[\s).,!?:;])/g, "$1$3")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>+[ \t]?/gm, "")
    .replace(/^[ \t]*[-+*][ \t]+\[[ xX]\][ \t]+/gm, "")
    .replace(/^[ \t]*[-+*][ \t]+/gm, "")
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, "")
    .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*$\n?/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\([\\`*_[\]{}()#+.!|>-])/g, "$1")
    .replace(/[*_]{2,}/g, "")
    .replace(/\|/g, " ")
    .replace(/&(#x?[\da-f]+|[a-z]+);/gi, (_match, entity: string) =>
      decodeSpeechEntity(entity.toLowerCase())
    )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
