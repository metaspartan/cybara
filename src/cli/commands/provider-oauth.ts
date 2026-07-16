export interface CliProviderOAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface OAuthResponse {
  status?: string;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  auth_url?: string;
  state?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  device_code?: string;
  interval?: number;
  expires_in?: number;
}

export interface CliProviderOAuthOptions {
  apiBase: string;
  providerType: string;
  oauthFlow: "device_code" | "redirect";
  headers: () => RequestInit["headers"];
  onVerification: (verification: { code?: string; url: string }) => void;
  fetchImpl?: typeof fetch;
  openExternal?: (url: string) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  minimumPollIntervalMs?: number;
}

function responseCredentials(data: OAuthResponse): CliProviderOAuthCredentials | null {
  if (data.status !== "success" || !data.access_token) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at,
  };
}

async function responseData(response: Response): Promise<OAuthResponse> {
  const data = (await response.json().catch(() => ({}))) as OAuthResponse;
  if (!response.ok) throw new Error(data.error || `OAuth request failed: HTTP ${response.status}`);
  return data;
}

export function openCliExternal(url: string): void {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
  } catch {
    return;
  }
}

async function connectDeviceCode(
  options: CliProviderOAuthOptions
): Promise<CliProviderOAuthCredentials> {
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((milliseconds: number) => Bun.sleep(milliseconds));
  const now = options.now || Date.now;
  const response = await fetchImpl(`${options.apiBase}/api/providers/oauth/device-code`, {
    method: "POST",
    headers: options.headers(),
    body: JSON.stringify({ providerType: options.providerType }),
  });
  const data = await responseData(response);
  const verificationUrl = data.verification_uri_complete || data.verification_uri;
  if (!data.device_code || !data.user_code || !verificationUrl) {
    throw new Error("Provider returned an incomplete authorization response");
  }
  options.onVerification({ code: data.user_code, url: verificationUrl });
  (options.openExternal || openCliExternal)(verificationUrl);

  let delay = Math.max(options.minimumPollIntervalMs ?? 5_000, (data.interval || 5) * 1_000);
  const deadline = now() + (data.expires_in || 900) * 1_000;
  while (now() < deadline) {
    await sleep(delay);
    const pollResponse = await fetchImpl(`${options.apiBase}/api/providers/oauth/poll`, {
      method: "POST",
      headers: options.headers(),
      body: JSON.stringify({ providerType: options.providerType, deviceCode: data.device_code }),
    });
    const pollData = await responseData(pollResponse);
    const credentials = responseCredentials(pollData);
    if (credentials) return credentials;
    if (pollData.status === "slow_down") delay += 5_000;
    if (pollData.status === "expired") throw new Error("Authorization code expired");
    if (pollData.status === "denied") throw new Error("Authorization was denied");
    if (pollData.status === "error") {
      throw new Error(pollData.error || "Authorization failed");
    }
  }
  throw new Error("Authorization timed out");
}

async function connectRedirect(
  options: CliProviderOAuthOptions
): Promise<CliProviderOAuthCredentials> {
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((milliseconds: number) => Bun.sleep(milliseconds));
  const now = options.now || Date.now;
  const response = await fetchImpl(`${options.apiBase}/api/providers/oauth/start`, {
    method: "POST",
    headers: options.headers(),
    body: JSON.stringify({ providerType: options.providerType }),
  });
  const data = await responseData(response);
  if (!data.auth_url || !data.state) {
    throw new Error("Provider returned an incomplete authorization response");
  }
  options.onVerification({ url: data.auth_url });
  (options.openExternal || openCliExternal)(data.auth_url);

  const delay = Math.max(options.minimumPollIntervalMs ?? 3_000, 3_000);
  const deadline = now() + 600_000;
  while (now() < deadline) {
    await sleep(delay);
    const pollResponse = await fetchImpl(`${options.apiBase}/api/providers/oauth/callback-status`, {
      method: "POST",
      headers: options.headers(),
      body: JSON.stringify({ state: data.state }),
    });
    if (pollResponse.status === 429) continue;
    const pollData = await responseData(pollResponse);
    const credentials = responseCredentials(pollData);
    if (credentials) return credentials;
    if (pollData.status === "error") {
      throw new Error(pollData.error || "Authorization failed");
    }
  }
  throw new Error("Authorization timed out");
}

export function connectCliProviderOAuth(
  options: CliProviderOAuthOptions
): Promise<CliProviderOAuthCredentials> {
  return options.oauthFlow === "device_code"
    ? connectDeviceCode(options)
    : connectRedirect(options);
}
