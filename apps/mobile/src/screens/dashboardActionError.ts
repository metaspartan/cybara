import { CybaraApiError } from "../lib/api";

export function gatewayActionError(error: unknown, fallback: string): string {
  if (error instanceof CybaraApiError) {
    if (error.status === 401 || error.status === 403) {
      return "This mobile profile does not have the scope required for that gateway action.";
    }
    return `Gateway returned ${error.status}.`;
  }
  return error instanceof Error ? error.message : fallback;
}
