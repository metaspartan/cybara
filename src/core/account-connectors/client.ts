import { randomUUID } from "crypto";
import {
  getRequiredConnectorScopes,
  getStoredAccountConnector,
  listAccountConnectorStatuses,
  storeAccountConnectorToken,
} from "./store";
import type { AccountConnectorId, StoredAccountConnector } from "./types";

const MAX_TEXT_BYTES = 512 * 1024;
const MAX_EVENT_TEXT = 10_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

interface GoogleMessagePart {
  mimeType?: unknown;
  body?: { data?: unknown };
  parts?: GoogleMessagePart[];
}

interface GoogleMessage {
  id?: unknown;
  threadId?: unknown;
  snippet?: unknown;
  internalDate?: unknown;
  payload?: GoogleMessagePart & {
    headers?: Array<{ name?: unknown; value?: unknown }>;
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function requiredString(value: unknown, name: string): string {
  const normalized = text(value);
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return text(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = text(item);
    return normalized ? [normalized] : [];
  });
}

function isoDateTime(value: unknown, name: string): string {
  const normalized = requiredString(value, name);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a valid date and time`);
  return new Date(parsed).toISOString();
}

function boundedText(value: unknown, maxLength = MAX_EVENT_TEXT): string | undefined {
  const normalized = text(value);
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function summarizeCalendarEvent(value: unknown): Record<string, unknown> {
  const event = recordValue(value);
  const start = recordValue(event.start);
  const end = recordValue(event.end);
  const organizer = recordValue(event.organizer);
  const attendees = Array.isArray(event.attendees)
    ? event.attendees.slice(0, 50).map((item) => {
        const attendee = recordValue(item);
        return {
          email: boundedText(attendee.email, 320),
          displayName: boundedText(attendee.displayName, 500),
          responseStatus: boundedText(attendee.responseStatus, 100),
        };
      })
    : [];
  return {
    id: boundedText(event.id, 1024),
    status: boundedText(event.status, 100),
    summary: boundedText(event.summary, 2_000),
    description: boundedText(event.description),
    location: boundedText(event.location, 2_000),
    htmlLink: boundedText(event.htmlLink, 4_096),
    start: boundedText(start.dateTime || start.date, 100),
    end: boundedText(end.dateTime || end.date, 100),
    organizer: boundedText(organizer.email, 320),
    attendees,
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const value = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    const record = value as Record<string, unknown>;
    const nested = recordValue(record.error);
    const message =
      text(nested.message) ||
      text(record.error_description) ||
      text(record.error_summary) ||
      text(record.error) ||
      `Connector request failed (${response.status})`;
    throw new Error(message);
  }
  return value;
}

async function refreshGoogle(stored: StoredAccountConnector): Promise<string> {
  if (!stored.clientId || !stored.refreshToken) throw new Error("Reconnect Google Workspace");
  const body = new URLSearchParams({
    client_id: stored.clientId,
    refresh_token: stored.refreshToken,
    grant_type: "refresh_token",
  });
  if (stored.clientSecret) body.set("client_secret", stored.clientSecret);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const value = await parseJsonResponse<{
    access_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  }>(response);
  const accessToken = requiredString(value.access_token, "Access token");
  storeAccountConnectorToken(
    "google_workspace",
    {
      accessToken,
      refreshToken: stored.refreshToken,
      expiresAt:
        typeof value.expires_in === "number" ? Date.now() + value.expires_in * 1000 : undefined,
      scopes:
        typeof value.scope === "string" ? value.scope.split(/\s+/).filter(Boolean) : stored.scopes,
    },
    stored.account
  );
  return accessToken;
}

async function refreshDropbox(stored: StoredAccountConnector): Promise<string> {
  if (!stored.clientId || !stored.refreshToken) throw new Error("Reconnect Dropbox");
  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: stored.clientId,
      refresh_token: stored.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const value = await parseJsonResponse<{ access_token?: unknown; expires_in?: unknown }>(response);
  const accessToken = requiredString(value.access_token, "Access token");
  storeAccountConnectorToken(
    "dropbox",
    {
      accessToken,
      refreshToken: stored.refreshToken,
      expiresAt:
        typeof value.expires_in === "number" ? Date.now() + value.expires_in * 1000 : undefined,
      scopes: stored.scopes,
    },
    stored.account
  );
  return accessToken;
}

async function accessToken(id: AccountConnectorId, write = false): Promise<string> {
  const stored = getStoredAccountConnector(id);
  if (write && stored.access !== "read_write") {
    throw new Error("Write access is disabled for this connector");
  }
  const requiredScopes = getRequiredConnectorScopes(id, write ? "read_write" : "read");
  if (requiredScopes.some((scope) => !stored.scopes.includes(scope))) {
    throw new Error("Reconnect this account to grant the required access");
  }
  if (stored.accessToken && (!stored.expiresAt || stored.expiresAt > Date.now() + 60_000)) {
    return stored.accessToken;
  }
  return id === "google_workspace" ? refreshGoogle(stored) : refreshDropbox(stored);
}

function decodeBase64Url(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return Buffer.from(value, "base64url").toString("utf8");
}

function messageBody(part: GoogleMessagePart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain") return decodeBase64Url(part.body?.data);
  for (const child of part.parts || []) {
    const content = messageBody(child);
    if (content) return content;
  }
  if (part.mimeType === "text/html") return decodeBase64Url(part.body?.data);
  return decodeBase64Url(part.body?.data);
}

function messageHeader(message: GoogleMessage, name: string): string | undefined {
  const header = message.payload?.headers?.find(
    (item) => typeof item.name === "string" && item.name.toLowerCase() === name.toLowerCase()
  );
  return optionalString(header?.value);
}

function summarizeMessage(message: GoogleMessage): Record<string, unknown> {
  return {
    id: optionalString(message.id),
    threadId: optionalString(message.threadId),
    from: messageHeader(message, "From"),
    to: messageHeader(message, "To"),
    subject: messageHeader(message, "Subject"),
    date: messageHeader(message, "Date"),
    snippet: optionalString(message.snippet),
  };
}

async function googleRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken("google_workspace", init?.method === "POST");
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });
  return parseJsonResponse<T>(response);
}

async function dropboxRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await accessToken("dropbox");
  const response = await fetch(`https://api.dropboxapi.com/2/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response);
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.ok) {
    const value = await response.text();
    throw new Error(value.slice(0, 500) || `Connector request failed (${response.status})`);
  }
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > MAX_TEXT_BYTES) throw new Error("File is too large to read in chat");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_TEXT_BYTES) throw new Error("File is too large to read in chat");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function gmailSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = optionalString(args.query) || "";
  const limit = boundedLimit(args.limit);
  const params = new URLSearchParams({ maxResults: String(limit) });
  if (query) params.set("q", query);
  const listed = await googleRequest<{ messages?: GoogleMessage[]; resultSizeEstimate?: number }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`
  );
  const messages = await Promise.all(
    (listed.messages || [])
      .slice(0, limit)
      .map((message) =>
        googleRequest<GoogleMessage>(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(requiredString(message.id, "Message ID"))}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
        )
      )
  );
  return {
    connector: "google_workspace",
    service: "gmail",
    untrustedExternalContent: true,
    resultSizeEstimate: listed.resultSizeEstimate || messages.length,
    messages: messages.map(summarizeMessage),
  };
}

export async function gmailRead(args: Record<string, unknown>): Promise<unknown> {
  const id = requiredString(args.messageId, "messageId");
  const message = await googleRequest<GoogleMessage>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`
  );
  return {
    connector: "google_workspace",
    service: "gmail",
    untrustedExternalContent: true,
    ...summarizeMessage(message),
    body: messageBody(message.payload).slice(0, MAX_TEXT_BYTES),
  };
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function driveSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = optionalString(args.query) || "";
  const limit = boundedLimit(args.limit);
  const q = query
    ? `trashed = false and (name contains '${escapeDriveQuery(query)}' or fullText contains '${escapeDriveQuery(query)}')`
    : "trashed = false";
  const params = new URLSearchParams({
    q,
    pageSize: String(limit),
    orderBy: "modifiedTime desc",
    fields:
      "files(id,name,mimeType,modifiedTime,size,webViewLink,owners(displayName,emailAddress))",
  });
  const value = await googleRequest<{ files?: unknown[] }>(
    `https://www.googleapis.com/drive/v3/files?${params}`
  );
  return {
    connector: "google_workspace",
    service: "drive",
    untrustedExternalContent: true,
    files: value.files || [],
  };
}

export async function driveRead(args: Record<string, unknown>): Promise<unknown> {
  const fileId = requiredString(args.fileId, "fileId");
  const token = await accessToken("google_workspace");
  const metadataResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,size,webViewLink`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const metadata = await parseJsonResponse<Record<string, unknown>>(metadataResponse);
  const mimeType = optionalString(metadata.mimeType) || "application/octet-stream";
  const exportMime =
    mimeType === "application/vnd.google-apps.document"
      ? "text/plain"
      : mimeType === "application/vnd.google-apps.spreadsheet"
        ? "text/csv"
        : mimeType === "application/vnd.google-apps.presentation"
          ? "text/plain"
          : undefined;
  const contentUrl = exportMime
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const response = await fetch(contentUrl, { headers: { Authorization: `Bearer ${token}` } });
  return {
    connector: "google_workspace",
    service: "drive",
    untrustedExternalContent: true,
    file: metadata,
    content: await boundedResponseText(response),
  };
}

export async function calendarList(args: Record<string, unknown>): Promise<unknown> {
  const limit = boundedLimit(args.limit);
  const now = Date.now();
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(limit),
    timeMin: optionalString(args.timeMin) || new Date(now).toISOString(),
    timeMax: optionalString(args.timeMax) || new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const query = optionalString(args.query);
  if (query) params.set("q", query);
  const value = await googleRequest<{ items?: unknown[]; nextPageToken?: unknown }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`
  );
  return {
    connector: "google_workspace",
    service: "calendar",
    untrustedExternalContent: true,
    events: (value.items || []).slice(0, limit).map(summarizeCalendarEvent),
    nextPageToken: optionalString(value.nextPageToken),
  };
}

function encodeEmailAddress(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function gmailSend(args: Record<string, unknown>): Promise<unknown> {
  const to = encodeEmailAddress(requiredString(args.to, "to"));
  const subject = encodeEmailAddress(requiredString(args.subject, "subject"));
  const body = requiredString(args.body, "body");
  const cc = optionalString(args.cc);
  const bcc = optionalString(args.bcc);
  const lines = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${encodeEmailAddress(cc)}`] : []),
    ...(bcc ? [`Bcc: ${encodeEmailAddress(bcc)}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ];
  const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
  const value = await googleRequest<Record<string, unknown>>(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw }),
    }
  );
  return { connector: "google_workspace", service: "gmail", sent: true, message: value };
}

export async function driveUpload(args: Record<string, unknown>): Promise<unknown> {
  const name = requiredString(args.name, "name");
  const content = requiredString(args.content, "content");
  const mimeType = optionalString(args.mimeType) || "text/plain";
  const folderId = optionalString(args.folderId);
  const token = await accessToken("google_workspace", true);
  const boundary = `cybara-${randomUUID()}`;
  const metadata = { name, ...(folderId ? { parents: [folderId] } : {}) };
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  const file = await parseJsonResponse<Record<string, unknown>>(response);
  return { connector: "google_workspace", service: "drive", uploaded: true, file };
}

export async function calendarCreate(args: Record<string, unknown>): Promise<unknown> {
  const summary = requiredString(args.summary, "summary");
  const start = isoDateTime(args.start, "start");
  const end = isoDateTime(args.end, "end");
  if (Date.parse(end) <= Date.parse(start)) throw new Error("end must be after start");
  const timeZone = optionalString(args.timeZone);
  const description = optionalString(args.description);
  const location = optionalString(args.location);
  const attendees = stringList(args.attendees)
    .slice(0, 50)
    .map((email) => ({ email: email.slice(0, 320) }));
  const event = await googleRequest<Record<string, unknown>>(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary,
        start: { dateTime: start, ...(timeZone ? { timeZone } : {}) },
        end: { dateTime: end, ...(timeZone ? { timeZone } : {}) },
        ...(description ? { description } : {}),
        ...(location ? { location } : {}),
        ...(attendees.length ? { attendees } : {}),
      }),
    }
  );
  return { connector: "google_workspace", service: "calendar", created: true, event };
}

export async function dropboxList(args: Record<string, unknown>): Promise<unknown> {
  const path = optionalString(args.path) || "";
  const limit = boundedLimit(args.limit);
  const value = await dropboxRequest<{ entries?: unknown[]; has_more?: boolean; cursor?: string }>(
    "files/list_folder",
    { path, recursive: false, include_deleted: false, limit }
  );
  return {
    connector: "dropbox",
    service: "files",
    untrustedExternalContent: true,
    entries: value.entries || [],
    hasMore: value.has_more === true,
    cursor: value.cursor,
  };
}

export async function dropboxSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = requiredString(args.query, "query");
  const path = optionalString(args.path);
  const limit = boundedLimit(args.limit);
  const value = await dropboxRequest<{ matches?: unknown[]; has_more?: boolean }>(
    "files/search_v2",
    {
      query,
      options: { ...(path ? { path } : {}), max_results: limit, file_status: "active" },
    }
  );
  return {
    connector: "dropbox",
    service: "files",
    untrustedExternalContent: true,
    matches: value.matches || [],
    hasMore: value.has_more === true,
  };
}

export async function dropboxRead(args: Record<string, unknown>): Promise<unknown> {
  const path = requiredString(args.path, "path");
  const token = await accessToken("dropbox");
  const response = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });
  const metadataHeader = response.headers.get("dropbox-api-result");
  return {
    connector: "dropbox",
    service: "files",
    untrustedExternalContent: true,
    metadata: metadataHeader ? JSON.parse(metadataHeader) : { path },
    content: await boundedResponseText(response),
  };
}

export async function dropboxUpload(args: Record<string, unknown>): Promise<unknown> {
  const path = requiredString(args.path, "path");
  const content = requiredString(args.content, "content");
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_BYTES) {
    throw new Error("Upload content is too large");
  }
  const overwrite = args.overwrite === true;
  const token = await accessToken("dropbox", true);
  const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": JSON.stringify({
        path,
        mode: overwrite ? "overwrite" : "add",
        autorename: !overwrite,
        mute: false,
      }),
    },
    body: content,
  });
  const file = await parseJsonResponse<Record<string, unknown>>(response);
  return { connector: "dropbox", service: "files", uploaded: true, file };
}

export function connectorReadAction(args: Record<string, unknown>): Promise<unknown> {
  const action = requiredString(args.action, "action");
  if (action === "list") {
    return Promise.resolve({
      connectors: listAccountConnectorStatuses().filter((connector) => connector.connected),
    });
  }
  if (action === "gmail_search") return gmailSearch(args);
  if (action === "gmail_read") return gmailRead(args);
  if (action === "drive_search") return driveSearch(args);
  if (action === "drive_read") return driveRead(args);
  if (action === "calendar_list") return calendarList(args);
  if (action === "dropbox_list") return dropboxList(args);
  if (action === "dropbox_search") return dropboxSearch(args);
  if (action === "dropbox_read") return dropboxRead(args);
  throw new Error(`Unsupported connector read action: ${action}`);
}

export function connectorWriteAction(args: Record<string, unknown>): Promise<unknown> {
  const action = requiredString(args.action, "action");
  if (action === "gmail_send") return gmailSend(args);
  if (action === "drive_upload") return driveUpload(args);
  if (action === "calendar_create") return calendarCreate(args);
  if (action === "dropbox_upload") return dropboxUpload(args);
  throw new Error(`Unsupported connector write action: ${action}`);
}
