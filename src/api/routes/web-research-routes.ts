import {
  getWebResearchSettingsStatus,
  updateWebResearchSettings,
  type WebResearchSettingsUpdate,
} from "../../core/web-research-settings";
import type { RouteHandler } from "./_shared";

export const webResearchRoutes: Record<string, RouteHandler> = {
  "GET /api/web-research/settings": () => getWebResearchSettingsStatus(),
  "PUT /api/web-research/settings": (body) =>
    updateWebResearchSettings((body || {}) as WebResearchSettingsUpdate),
};
