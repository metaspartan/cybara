import {
  latestSessionEventSequence,
  listRunEvents,
  listSessionEvents,
} from "../../core/session-event-ledger";
import type { RouteHandler } from "./_shared";

function boundedInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, parsed)) : fallback;
}

export const sessionEventRoutes: Record<string, RouteHandler> = {
  "GET /api/sessions/:id/events": (_body, params) => {
    const sessionId = params?.id || "";
    const after = boundedInteger(params?.after, 0, Number.MAX_SAFE_INTEGER);
    const limit = boundedInteger(params?.limit, 1000, 5000) || 1;
    const events = listSessionEvents(sessionId, after, limit);
    return {
      session_id: sessionId,
      events,
      latest_sequence: latestSessionEventSequence(sessionId),
      has_more: events.length === limit,
    };
  },
  "GET /api/session-runs/:id/events": (_body, params) => ({
    run_id: params?.id || "",
    events: listRunEvents(params?.id || "", boundedInteger(params?.limit, 1000, 5000) || 1),
  }),
};
