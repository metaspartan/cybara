import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/auth";
import type { AvailableProvider } from "@/types";
import { openExternal } from "@/utils/openExternal";

export type ProviderOAuthState = "idle" | "connecting" | "polling" | "success" | "error";

export interface ProviderOAuthCredentials {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

interface ProviderOAuthDeviceCode {
  user_code: string;
  verification_uri: string;
}

interface ProviderOAuthResponse {
  status?: string;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  auth_url?: string;
  state?: string;
  poll_token?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  device_code?: string;
  interval?: number;
  expires_in?: number;
}

function oauthCredentials(data: ProviderOAuthResponse): ProviderOAuthCredentials | null {
  if (data.status !== "success" || !data.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  };
}

async function oauthResponse(response: Response): Promise<ProviderOAuthResponse> {
  const data = (await response.json()) as ProviderOAuthResponse;
  if (!response.ok) throw new Error(data.error || "OAuth request failed");
  return data;
}

export function useProviderOAuth(provider: AvailableProvider | null) {
  const [state, setState] = useState<ProviderOAuthState>("idle");
  const [deviceCode, setDeviceCode] = useState<ProviderOAuthDeviceCode | null>(null);
  const [credentials, setCredentials] = useState<ProviderOAuthCredentials | null>(null);
  const [error, setError] = useState("");
  const cancelledRef = useRef(false);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setState("idle");
    setDeviceCode(null);
    setCredentials(null);
    setError("");
  }, []);

  useEffect(
    () => () => {
      cancelledRef.current = true;
    },
    []
  );
  useEffect(() => {
    cancelledRef.current = false;
    setState("idle");
    setDeviceCode(null);
    setCredentials(null);
    setError("");
  }, [provider?.id]);

  const fail = useCallback((reason: unknown): null => {
    setError(reason instanceof Error ? reason.message : "OAuth authorization failed");
    setState("error");
    return null;
  }, []);

  const pollDeviceCode = useCallback(
    async (providerType: string, code: string, intervalMs: number, deadline: number) => {
      let delay = intervalMs;
      while (Date.now() < deadline && !cancelledRef.current) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (cancelledRef.current) return null;
        const response = await apiFetch("/api/providers/oauth/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerType, deviceCode: code }),
        });
        const data = (await response.json()) as ProviderOAuthResponse;
        const result = oauthCredentials(data);
        if (result) return result;
        if (data.status === "slow_down") delay += 5_000;
        if (data.status === "expired") throw new Error("Authorization code expired");
        if (data.status === "denied") throw new Error("Authorization was denied");
        if (data.status === "error") throw new Error(data.error || "Authorization failed");
      }
      if (!cancelledRef.current) throw new Error("Authorization timed out. Please try again.");
      return null;
    },
    []
  );

  const connectDeviceCode = useCallback(async () => {
    if (!provider) return null;
    const response = await apiFetch("/api/providers/oauth/device-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerType: provider.id }),
    });
    const data = await oauthResponse(response);
    const verificationUri = data.verification_uri_complete || data.verification_uri;
    if (!data.device_code || !data.user_code || !verificationUri) {
      throw new Error("Provider returned an incomplete authorization response");
    }
    setDeviceCode({ user_code: data.user_code, verification_uri: verificationUri });
    setState("polling");
    await openExternal(verificationUri);
    return pollDeviceCode(
      provider.id,
      data.device_code,
      Math.max(5_000, (data.interval || 5) * 1_000),
      Date.now() + (data.expires_in || 900) * 1_000
    );
  }, [pollDeviceCode, provider]);

  const connectRedirect = useCallback(async () => {
    if (!provider) return null;
    const response = await apiFetch("/api/providers/oauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerType: provider.id }),
    });
    const data = await oauthResponse(response);
    if (!data.auth_url || !data.state || !data.poll_token) {
      throw new Error("Provider returned an incomplete authorization response");
    }
    await openExternal(data.auth_url);
    setState("polling");
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline && !cancelledRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      if (cancelledRef.current) return null;
      const pollResponse = await apiFetch("/api/providers/oauth/callback-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: data.state, poll_token: data.poll_token }),
      });
      if (pollResponse.status === 429) continue;
      const pollData = (await pollResponse.json()) as ProviderOAuthResponse;
      const result = oauthCredentials(pollData);
      if (result) return result;
      if (pollData.status === "error") throw new Error(pollData.error || "Authorization failed");
    }
    if (!cancelledRef.current) throw new Error("Authorization timed out. Please try again.");
    return null;
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) return null;
    cancelledRef.current = false;
    setState("connecting");
    setDeviceCode(null);
    setCredentials(null);
    setError("");
    try {
      const result =
        provider.oauthFlow === "device_code" ? await connectDeviceCode() : await connectRedirect();
      if (!result || cancelledRef.current) return null;
      setCredentials(result);
      setState("success");
      return result;
    } catch (reason) {
      return fail(reason);
    }
  }, [connectDeviceCode, connectRedirect, fail, provider]);

  return { state, deviceCode, credentials, error, connect, reset };
}
