const TOOL_PROTOCOL_MARKER_PATTERN = /<[|\uFF5C]+DSML[|\uFF5C]+/i;
const TOOL_PROTOCOL_BLOCK_PATTERN =
  /<[|\uFF5C]+DSML[|\uFF5C]+[a-z_][\w.:-]*(?:\s[^>]*)?>[\s\S]*?<\/[|\uFF5C]+DSML[|\uFF5C]+[a-z_][\w.:-]*>/gi;
const TOOL_PROTOCOL_TAG_PATTERN = /<\/?[|\uFF5C]+DSML[|\uFF5C]+[^>]*>/gi;

export const PROVIDER_PROTOCOL_RECOVERY_MESSAGE =
  "The provider returned an invalid tool-call response for this turn. Retry the message to get a usable answer.";

export interface ProviderProtocolPresentation {
  content: string;
  protocolRemoved: boolean;
}

export function presentProviderProtocolText(content: string): ProviderProtocolPresentation {
  if (!TOOL_PROTOCOL_MARKER_PATTERN.test(content)) {
    return { content, protocolRemoved: false };
  }
  let visible = content.replace(TOOL_PROTOCOL_BLOCK_PATTERN, "");
  const danglingMarkerIndex = visible.search(TOOL_PROTOCOL_MARKER_PATTERN);
  if (danglingMarkerIndex >= 0) visible = visible.slice(0, danglingMarkerIndex);
  visible = visible
    .replace(TOOL_PROTOCOL_TAG_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    content: visible || PROVIDER_PROTOCOL_RECOVERY_MESSAGE,
    protocolRemoved: true,
  };
}
