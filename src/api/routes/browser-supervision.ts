import { getStatus } from "../../core/browser/pw-manager";
import {
  getBrowserSupervisionSettings,
  setBrowserSupervisionSettings,
} from "../../core/browser/supervision";
import type { RouteHandler } from "./_shared";

export const browserSupervisionRoutes: Record<string, RouteHandler> = {
  "GET /api/browser/supervision": async () => ({
    settings: getBrowserSupervisionSettings(),
    status: (await getStatus()).supervision,
  }),
  "PUT /api/browser/supervision": async (body) => ({
    success: true,
    settings: setBrowserSupervisionSettings(body),
    status: (await getStatus()).supervision,
  }),
};
