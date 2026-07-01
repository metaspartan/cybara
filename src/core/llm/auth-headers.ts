export function applyProviderApiKey(
  headers: Record<string, string>,
  auth: string,
  apiKeyHeader?: string
): Record<string, string> {
  if (!auth) return headers;
  if (apiKeyHeader) {
    headers[apiKeyHeader] = auth;
  } else {
    headers.Authorization = `Bearer ${auth}`;
  }
  return headers;
}
