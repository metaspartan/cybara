import { isLikelyGoogleApiKey } from "./_shared";
import { validatePublicHttpUrlShape } from "../../core/outbound-url-policy";

export function validateProviderCredentialShape(
  providerType: string,
  credentials: { apiKey?: string; accessToken?: string }
): void {
  if (providerType === "openai" && credentials.apiKey && !credentials.apiKey.startsWith("sk-")) {
    throw new Error("Validation error: OpenAI API key must start with 'sk-'");
  }

  if (providerType === "google" && credentials.apiKey) {
    const trimmed = credentials.apiKey.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      throw new Error(
        "Validation error: Google API key looks like a URL. Paste an AI Studio key (starts with 'AIza')."
      );
    }
    const looksLikeOAuthJson = trimmed.startsWith("{") && trimmed.endsWith("}");
    const looksLikeApiKey = isLikelyGoogleApiKey(trimmed);
    if (!looksLikeOAuthJson && !looksLikeApiKey) {
      throw new Error(
        "Validation error: Google API key format is invalid. Expected AI Studio key starting with 'AIza'."
      );
    }
  }
}

export function validateProviderBaseUrlShape(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Validation error: Provider base URL must be a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Validation error: Provider base URL must use http or https.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Validation error: Provider base URL cannot include embedded credentials.");
  }
}

export function validatePluginProviderBaseUrl(
  baseUrl: string,
  allowPrivateEndpoint: boolean
): void {
  validateProviderBaseUrlShape(baseUrl);
  if (allowPrivateEndpoint) return;
  const validation = validatePublicHttpUrlShape(baseUrl);
  if (!validation.valid) {
    throw new Error(
      `Validation error: Plugin provider endpoint is not public: ${validation.error || "blocked destination"}`
    );
  }
}
