import { createPkcePair, jwtExpiresAt } from "../core/provider-oauth";

interface CursorOAuthSession {
  uuid: string;
  verifier: string;
  expiresAt: number;
}

const CURSOR_LOGIN_URL = "https://cursor.com/loginDeepControl";
const CURSOR_POLL_URL = "https://api2.cursor.sh/auth/poll";
const SESSION_TTL_MS = 15 * 60_000;
const MAX_SESSIONS = 100;
const sessions = new Map<string, CursorOAuthSession>();

function expireSessions(now: number): void {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (typeof oldest !== "string") break;
    sessions.delete(oldest);
  }
}

export async function startCursorOAuth(): Promise<Record<string, unknown>> {
  const now = Date.now();
  expireSessions(now);
  const { verifier, challenge } = await createPkcePair();
  const uuid = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const expiresAt = now + SESSION_TTL_MS;
  sessions.set(sessionId, { uuid, verifier, expiresAt });
  const params = new URLSearchParams({ challenge, uuid, mode: "login", redirectTarget: "cli" });
  const verificationUri = `${CURSOR_LOGIN_URL}?${params.toString()}`;
  return {
    device_code: sessionId,
    user_code: "Browser login",
    verification_uri: verificationUri,
    verification_uri_complete: verificationUri,
    expires_in: SESSION_TTL_MS / 1000,
    interval: 1,
  };
}

export async function pollCursorOAuth(deviceCode: string): Promise<Record<string, unknown>> {
  const session = sessions.get(deviceCode);
  if (!session) return { status: "expired" };
  if (session.expiresAt <= Date.now()) {
    sessions.delete(deviceCode);
    return { status: "expired" };
  }
  const params = new URLSearchParams({ uuid: session.uuid, verifier: session.verifier });
  const response = await fetch(`${CURSOR_POLL_URL}?${params.toString()}`, {
    headers: { Accept: "application/json", "User-Agent": "Cybara" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return { status: "pending" };
  if (!response.ok) {
    return { status: "error", error: `Cursor login failed: HTTP ${response.status}` };
  }
  const value = (await response.json()) as Record<string, unknown>;
  const accessToken = value.accessToken;
  const refreshToken = value.refreshToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { status: "error", error: "Cursor login returned an incomplete token response" };
  }
  sessions.delete(deviceCode);
  return {
    status: "success",
    access_token: accessToken,
    refresh_token:
      typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : accessToken,
    expires_at: jwtExpiresAt(accessToken),
  };
}

export function cursorOAuthSessionCount(): number {
  return sessions.size;
}
