import {
  isAccountConnectorId,
  listAccountConnectorStatuses,
  updateAccountConnectorConfig,
} from "../../core/account-connectors/store";
import {
  failAccountConnectorOAuth,
  finishAccountConnectorOAuth,
  getAccountConnectorOAuthStatus,
  startAccountConnectorOAuth,
  revokeAccountConnector,
} from "../../core/account-connectors/oauth";
import type { AccountConnectorConfigUpdate } from "../../core/account-connectors/types";
import type { RouteHandler } from "./_shared";

function connectorId(value: unknown) {
  if (!isAccountConnectorId(value)) throw new Error("Unsupported account connector");
  return value;
}

export const accountConnectorRoutes: Record<string, RouteHandler> = {
  "GET /api/connectors": () => listAccountConnectorStatuses(),
  "PUT /api/connectors/:id": (body, params) =>
    updateAccountConnectorConfig(
      connectorId(params?.id),
      (body || {}) as AccountConnectorConfigUpdate
    ),
  "DELETE /api/connectors/:id": (_body, params) => revokeAccountConnector(connectorId(params?.id)),
  "POST /api/connectors/:id/oauth/start": (_body, params) =>
    startAccountConnectorOAuth(connectorId(params?.id)),
  "GET /api/connectors/oauth/status": (_body, params) =>
    params?.state ? getAccountConnectorOAuthStatus(params.state) : { status: "not_found" },
  "GET /api/connectors/oauth/callback": async (_body, params) => {
    if (!params?.state) return { success: false, error: "OAuth state is missing" };
    if (params.error) {
      failAccountConnectorOAuth(params.state, params.error);
      return { success: false, error: params.error };
    }
    if (!params.code) {
      failAccountConnectorOAuth(params.state, "OAuth authorization code is missing");
      return { success: false, error: "OAuth authorization code is missing" };
    }
    await finishAccountConnectorOAuth(params.state, params.code);
    return { success: true };
  },
};
