import { randomUUID } from "crypto";
import { listAccountConnectorStatuses } from "./store";
import {
  boundedConnectorResponseText,
  connectorBoundedText,
  connectorFetch,
  connectorIsoDateTime,
  connectorLimit,
  connectorRecord,
  connectorRequiredString,
  connectorStringList,
  connectorText,
  ensureConnectorContentSize,
  MAX_CONNECTOR_TEXT_BYTES,
  parseConnectorJson,
} from "./request";
import { getAccountConnectorAccessToken } from "./tokens";
import {
  microsoftCalendarCreate,
  microsoftCalendarList,
  oneDriveRead,
  oneDriveSearch,
  oneDriveUpload,
  outlookRead,
  outlookSearch,
  outlookSend,
} from "./microsoft";
import { notionCreatePage, notionRead, notionSearch } from "./notion";

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

function summarizeCalendarEvent(value: unknown): Record<string, unknown> {
  const event = connectorRecord(value);
  const start = connectorRecord(event.start);
  const end = connectorRecord(event.end);
  const organizer = connectorRecord(event.organizer);
  const attendees = Array.isArray(event.attendees)
    ? event.attendees.slice(0, 50).map((item) => {
        const attendee = connectorRecord(item);
        return {
          email: connectorBoundedText(attendee.email, 320),
          displayName: connectorBoundedText(attendee.displayName, 500),
          responseStatus: connectorBoundedText(attendee.responseStatus, 100),
        };
      })
    : [];
  return {
    id: connectorBoundedText(event.id, 1024),
    status: connectorBoundedText(event.status, 100),
    summary: connectorBoundedText(event.summary, 2_000),
    description: connectorBoundedText(event.description),
    location: connectorBoundedText(event.location, 2_000),
    htmlLink: connectorBoundedText(event.htmlLink, 4_096),
    start: connectorBoundedText(start.dateTime || start.date, 100),
    end: connectorBoundedText(end.dateTime || end.date, 100),
    organizer: connectorBoundedText(organizer.email, 320),
    attendees,
  };
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
  return connectorText(header?.value);
}

function summarizeMessage(message: GoogleMessage): Record<string, unknown> {
  return {
    id: connectorText(message.id),
    threadId: connectorText(message.threadId),
    from: messageHeader(message, "From"),
    to: messageHeader(message, "To"),
    subject: messageHeader(message, "Subject"),
    date: messageHeader(message, "Date"),
    snippet: connectorText(message.snippet),
  };
}

async function googleRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccountConnectorAccessToken("google_workspace", init?.method === "POST");
  const response = await connectorFetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });
  return parseConnectorJson<T>(response);
}

async function dropboxRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await getAccountConnectorAccessToken("dropbox");
  const response = await connectorFetch(`https://api.dropboxapi.com/2/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseConnectorJson<T>(response);
}

export async function gmailSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = connectorText(args.query) || "";
  const limit = connectorLimit(args.limit);
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
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(connectorRequiredString(message.id, "Message ID"))}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
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
  const id = connectorRequiredString(args.messageId, "messageId");
  const message = await googleRequest<GoogleMessage>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`
  );
  return {
    connector: "google_workspace",
    service: "gmail",
    untrustedExternalContent: true,
    ...summarizeMessage(message),
    body: messageBody(message.payload).slice(0, MAX_CONNECTOR_TEXT_BYTES),
  };
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function driveSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = connectorText(args.query) || "";
  const limit = connectorLimit(args.limit);
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
  const fileId = connectorRequiredString(args.fileId, "fileId");
  const token = await getAccountConnectorAccessToken("google_workspace");
  const metadataResponse = await connectorFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,size,webViewLink`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const metadata = await parseConnectorJson<Record<string, unknown>>(metadataResponse);
  const mimeType = connectorText(metadata.mimeType) || "application/octet-stream";
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
  const response = await connectorFetch(contentUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    connector: "google_workspace",
    service: "drive",
    untrustedExternalContent: true,
    file: metadata,
    content: await boundedConnectorResponseText(response),
  };
}

export async function calendarList(args: Record<string, unknown>): Promise<unknown> {
  const limit = connectorLimit(args.limit);
  const now = Date.now();
  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(limit),
    timeMin: connectorText(args.timeMin) || new Date(now).toISOString(),
    timeMax: connectorText(args.timeMax) || new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
  const query = connectorText(args.query);
  if (query) params.set("q", query);
  const value = await googleRequest<{ items?: unknown[]; nextPageToken?: unknown }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`
  );
  return {
    connector: "google_workspace",
    service: "calendar",
    untrustedExternalContent: true,
    events: (value.items || []).slice(0, limit).map(summarizeCalendarEvent),
    nextPageToken: connectorText(value.nextPageToken),
  };
}

function encodeEmailAddress(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function gmailSend(args: Record<string, unknown>): Promise<unknown> {
  const to = encodeEmailAddress(connectorRequiredString(args.to, "to"));
  const subject = encodeEmailAddress(connectorRequiredString(args.subject, "subject"));
  const body = connectorRequiredString(args.body, "body");
  const cc = connectorText(args.cc);
  const bcc = connectorText(args.bcc);
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
  const name = connectorRequiredString(args.name, "name");
  const content = connectorRequiredString(args.content, "content");
  const mimeType = connectorText(args.mimeType) || "text/plain";
  const folderId = connectorText(args.folderId);
  const token = await getAccountConnectorAccessToken("google_workspace", true);
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
  const response = await connectorFetch(
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
  const file = await parseConnectorJson<Record<string, unknown>>(response);
  return { connector: "google_workspace", service: "drive", uploaded: true, file };
}

export async function calendarCreate(args: Record<string, unknown>): Promise<unknown> {
  const summary = connectorRequiredString(args.summary, "summary");
  const start = connectorIsoDateTime(args.start, "start");
  const end = connectorIsoDateTime(args.end, "end");
  if (Date.parse(end) <= Date.parse(start)) throw new Error("end must be after start");
  const timeZone = connectorText(args.timeZone);
  const description = connectorText(args.description);
  const location = connectorText(args.location);
  const attendees = connectorStringList(args.attendees)
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
  const path = connectorText(args.path) || "";
  const limit = connectorLimit(args.limit);
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
  const query = connectorRequiredString(args.query, "query");
  const path = connectorText(args.path);
  const limit = connectorLimit(args.limit);
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
  const path = connectorRequiredString(args.path, "path");
  const token = await getAccountConnectorAccessToken("dropbox");
  const response = await connectorFetch("https://content.dropboxapi.com/2/files/download", {
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
    content: await boundedConnectorResponseText(response),
  };
}

export async function dropboxUpload(args: Record<string, unknown>): Promise<unknown> {
  const path = connectorRequiredString(args.path, "path");
  const content = connectorRequiredString(args.content, "content");
  ensureConnectorContentSize(content);
  const overwrite = args.overwrite === true;
  const token = await getAccountConnectorAccessToken("dropbox", true);
  const response = await connectorFetch("https://content.dropboxapi.com/2/files/upload", {
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
  const file = await parseConnectorJson<Record<string, unknown>>(response);
  return { connector: "dropbox", service: "files", uploaded: true, file };
}

export function connectorReadAction(args: Record<string, unknown>): Promise<unknown> {
  const action = connectorRequiredString(args.action, "action");
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
  if (action === "outlook_search") return outlookSearch(args);
  if (action === "outlook_read") return outlookRead(args);
  if (action === "onedrive_search") return oneDriveSearch(args);
  if (action === "onedrive_read") return oneDriveRead(args);
  if (action === "microsoft_calendar_list") return microsoftCalendarList(args);
  if (action === "dropbox_list") return dropboxList(args);
  if (action === "dropbox_search") return dropboxSearch(args);
  if (action === "dropbox_read") return dropboxRead(args);
  if (action === "notion_search") return notionSearch(args);
  if (action === "notion_read") return notionRead(args);
  throw new Error(`Unsupported connector read action: ${action}`);
}

export function connectorWriteAction(args: Record<string, unknown>): Promise<unknown> {
  const action = connectorRequiredString(args.action, "action");
  if (action === "gmail_send") return gmailSend(args);
  if (action === "drive_upload") return driveUpload(args);
  if (action === "calendar_create") return calendarCreate(args);
  if (action === "outlook_send") return outlookSend(args);
  if (action === "onedrive_upload") return oneDriveUpload(args);
  if (action === "microsoft_calendar_create") return microsoftCalendarCreate(args);
  if (action === "dropbox_upload") return dropboxUpload(args);
  if (action === "notion_create_page") return notionCreatePage(args);
  throw new Error(`Unsupported connector write action: ${action}`);
}
