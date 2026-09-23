import { formatExpandedToolActivityDetail } from "../../shared/tool-activity-detail";

export const LIVE_TOOL_DETAIL_MAX_CHARS = 8_000;

export function liveToolFullDetail(
  toolName: string,
  args: Record<string, unknown>,
  phase: "start" | "result" | "error" | "blocked",
  result?: unknown
): string | undefined {
  let detail: string | undefined;
  try {
    detail = formatExpandedToolActivityDetail(toolName, args, phase, result)?.trim();
  } catch {
    return undefined;
  }
  if (!detail) return undefined;
  return detail.length > LIVE_TOOL_DETAIL_MAX_CHARS
    ? `${detail.slice(0, LIVE_TOOL_DETAIL_MAX_CHARS)}…`
    : detail;
}
