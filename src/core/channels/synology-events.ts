export interface SynologyInbound {
  token: string;
  userId: string;
  username: string;
  text: string;
}

export function parseSynologyForm(rawBody: string): SynologyInbound | null {
  if (!rawBody) return null;
  const params = new URLSearchParams(rawBody);
  const text = (params.get("text") || "").trim();
  if (!text) return null;
  return {
    token: params.get("token") || "",
    userId: params.get("user_id") || "",
    username: params.get("username") || "",
    text,
  };
}
