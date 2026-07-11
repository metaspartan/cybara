import {
  getIntegrationCredentialsStatus,
  type IntegrationCredentialsUpdate,
  updateIntegrationCredentials,
} from "../../core/integration-credentials";
import type { RouteHandler } from "./_shared";

export const integrationCredentialRoutes: Record<string, RouteHandler> = {
  "GET /api/integration-credentials": () => getIntegrationCredentialsStatus(),
  "PUT /api/integration-credentials": (body) =>
    updateIntegrationCredentials((body || {}) as IntegrationCredentialsUpdate),
};
