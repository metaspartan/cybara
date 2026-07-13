export const ACCOUNT_CONNECTOR_IDS = ["google_workspace", "dropbox"] as const;

export type AccountConnectorId = (typeof ACCOUNT_CONNECTOR_IDS)[number];
export type AccountConnectorAccess = "read" | "read_write";

export interface AccountConnectorDefinition {
  id: AccountConnectorId;
  label: string;
  description: string;
  services: string[];
  docsUrl: string;
  clientIdLabel: string;
  clientSecretLabel?: string;
}

export interface AccountConnectorStatus extends AccountConnectorDefinition {
  redirectUri: string;
  configured: boolean;
  connected: boolean;
  access: AccountConnectorAccess;
  account?: string;
  scopes: string[];
  needsReauthorization: boolean;
}

export interface AccountConnectorConfigUpdate {
  clientId?: unknown;
  clientSecret?: unknown;
  access?: unknown;
}

export interface AccountConnectorOAuthStart {
  state: string;
  authUrl: string;
  expiresAt: number;
}

export interface AccountConnectorOAuthStatus {
  status: "pending" | "connected" | "error" | "not_found";
  connectorId?: AccountConnectorId;
  error?: string;
}

export interface StoredAccountConnector {
  clientId?: string;
  clientSecret?: string;
  access: AccountConnectorAccess;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
  account?: string;
}

export interface AccountConnectorToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
}
