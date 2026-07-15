import {
  getToolCapabilityPolicy,
  setToolCapabilityPolicy,
} from "../../core/tool-capability-policy";
import type { RouteHandler } from "./_shared";

export const toolCapabilityPolicyRoutes: Record<string, RouteHandler> = {
  "GET /api/settings/tool-capabilities": () => ({
    policy: getToolCapabilityPolicy(),
  }),
  "PUT /api/settings/tool-capabilities": (body) => ({
    success: true,
    policy: setToolCapabilityPolicy(body),
  }),
};
