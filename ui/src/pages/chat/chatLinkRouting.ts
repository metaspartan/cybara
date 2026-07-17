export interface ChatLinkOpenOptions {
  external: boolean;
}

export type ChatLinkRoute =
  | { kind: "preview"; url: string }
  | { kind: "external"; url: string }
  | { kind: "internal"; url: string }
  | { kind: "blocked"; url: string };

const HOST_LINK_PATTERN =
  /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[^/\s]+\.[a-z]{2,})(?::\d+)?(?:[/?#]|$)/i;
const LOCAL_LINK_PATTERN =
  /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#]|$)/i;
const URI_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;

export function routeChatLink(href: string, options: ChatLinkOpenOptions): ChatLinkRoute {
  const value = href.trim();
  if (!value) return { kind: "blocked", url: value };
  if (
    value.startsWith("#") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../")
  ) {
    return { kind: "internal", url: value };
  }

  const hasExplicitScheme = URI_SCHEME_PATTERN.test(value) && !LOCAL_LINK_PATTERN.test(value);
  const candidate =
    !hasExplicitScheme && HOST_LINK_PATTERN.test(value)
      ? `${LOCAL_LINK_PATTERN.test(value) ? "http" : "https"}://${value}`
      : value;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { kind: "blocked", url: value };
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    return {
      kind: options.external ? "external" : "preview",
      url: url.toString(),
    };
  }
  if (url.protocol === "mailto:" || url.protocol === "tel:") {
    return { kind: "external", url: url.toString() };
  }
  return { kind: "blocked", url: value };
}
