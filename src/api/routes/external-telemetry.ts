import {
  flushExternalTelemetry,
  getExternalTelemetrySettings,
  getExternalTelemetryStatus,
  renderPrometheusMetrics,
  setExternalTelemetrySettings,
  testExternalTelemetry,
} from "../../core/external-telemetry";
import { makeRawHttpResponse, type RouteHandler } from "./_shared";

export const externalTelemetryRoutes: Record<string, RouteHandler> = {
  "GET /api/telemetry/settings": () => getExternalTelemetrySettings(),
  "PUT /api/telemetry/settings": (body) => ({
    success: true,
    settings: setExternalTelemetrySettings(body),
  }),
  "GET /api/telemetry/status": () => getExternalTelemetryStatus(),
  "GET /api/telemetry/prometheus": () =>
    makeRawHttpResponse(renderPrometheusMetrics(), "text/plain; version=0.0.4; charset=utf-8"),
  "POST /api/telemetry/flush": async () => ({
    success: true,
    status: await flushExternalTelemetry(),
  }),
  "POST /api/telemetry/test": async () => ({
    success: true,
    status: await testExternalTelemetry(),
  }),
};
