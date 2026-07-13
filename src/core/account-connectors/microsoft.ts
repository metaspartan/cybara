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
  parseConnectorJson,
} from "./request";
import { getAccountConnectorAccessToken } from "./tokens";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

async function graphRequest<T>(path: string, init?: RequestInit, write = false): Promise<T> {
  const token = await getAccountConnectorAccessToken("microsoft_365", write);
  const response = await connectorFetch(`${GRAPH_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...init?.headers,
    },
  });
  return parseConnectorJson<T>(response);
}

function graphAddress(value: unknown): string | undefined {
  const address = connectorRecord(connectorRecord(value).emailAddress);
  return connectorBoundedText(address.address, 320);
}

function graphAddresses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const address = graphAddress(entry);
    return address ? [address] : [];
  });
}

function summarizeMessage(value: unknown): Record<string, unknown> {
  const message = connectorRecord(value);
  return {
    id: connectorBoundedText(message.id, 1024),
    subject: connectorBoundedText(message.subject, 2_000),
    from: graphAddress(message.from),
    to: graphAddresses(message.toRecipients),
    receivedAt: connectorBoundedText(message.receivedDateTime, 100),
    preview: connectorBoundedText(message.bodyPreview),
    webLink: connectorBoundedText(message.webLink, 4_096),
  };
}

function summarizeEvent(value: unknown): Record<string, unknown> {
  const event = connectorRecord(value);
  const start = connectorRecord(event.start);
  const end = connectorRecord(event.end);
  return {
    id: connectorBoundedText(event.id, 1024),
    subject: connectorBoundedText(event.subject, 2_000),
    preview: connectorBoundedText(event.bodyPreview),
    location: connectorBoundedText(connectorRecord(event.location).displayName, 2_000),
    start: connectorBoundedText(start.dateTime, 100),
    end: connectorBoundedText(end.dateTime, 100),
    timeZone: connectorBoundedText(start.timeZone, 100),
    organizer: graphAddress(connectorRecord(event.organizer)),
    attendees: Array.isArray(event.attendees)
      ? event.attendees.slice(0, 50).flatMap((item) => {
          const address = graphAddress(item);
          return address ? [address] : [];
        })
      : [],
    webLink: connectorBoundedText(event.webLink, 4_096),
  };
}

function graphSearchQuery(value: string): string {
  return `\"${value.replace(/[\"\\]/g, " ").slice(0, 500)}\"`;
}

export async function outlookSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = connectorText(args.query);
  const limit = connectorLimit(args.limit);
  const params = new URLSearchParams({
    $top: String(limit),
    $select: "id,subject,from,toRecipients,receivedDateTime,bodyPreview,webLink",
    $orderby: "receivedDateTime desc",
  });
  if (query) {
    params.set("$search", graphSearchQuery(query));
    params.delete("$orderby");
  }
  const value = await graphRequest<{ value?: unknown[] }>(`/me/messages?${params}`);
  return {
    connector: "microsoft_365",
    service: "outlook",
    untrustedExternalContent: true,
    messages: (value.value || []).slice(0, limit).map(summarizeMessage),
  };
}

export async function outlookRead(args: Record<string, unknown>): Promise<unknown> {
  const messageId = connectorRequiredString(args.messageId, "messageId");
  const message = await graphRequest<Record<string, unknown>>(
    `/me/messages/${encodeURIComponent(messageId)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,webLink`
  );
  const body = connectorRecord(message.body);
  return {
    connector: "microsoft_365",
    service: "outlook",
    untrustedExternalContent: true,
    ...summarizeMessage(message),
    cc: graphAddresses(message.ccRecipients),
    body: connectorBoundedText(body.content),
  };
}

export async function oneDriveSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = connectorRequiredString(args.query, "query");
  const limit = connectorLimit(args.limit);
  const escaped = query.replace(/'/g, "''").slice(0, 500);
  const params = new URLSearchParams({
    $top: String(limit),
    $select: "id,name,size,lastModifiedDateTime,webUrl,file,folder,parentReference",
  });
  const value = await graphRequest<{ value?: unknown[] }>(
    `/me/drive/root/search(q='${encodeURIComponent(escaped)}')?${params}`
  );
  return {
    connector: "microsoft_365",
    service: "onedrive",
    untrustedExternalContent: true,
    files: value.value || [],
  };
}

export async function oneDriveRead(args: Record<string, unknown>): Promise<unknown> {
  const fileId = connectorRequiredString(args.fileId, "fileId");
  const token = await getAccountConnectorAccessToken("microsoft_365");
  const metadata = await graphRequest<Record<string, unknown>>(
    `/me/drive/items/${encodeURIComponent(fileId)}?$select=id,name,size,lastModifiedDateTime,webUrl,file,parentReference`
  );
  const response = await connectorFetch(
    `${GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(fileId)}/content`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return {
    connector: "microsoft_365",
    service: "onedrive",
    untrustedExternalContent: true,
    file: metadata,
    content: await boundedConnectorResponseText(response),
  };
}

export async function microsoftCalendarList(args: Record<string, unknown>): Promise<unknown> {
  const limit = connectorLimit(args.limit);
  const now = Date.now();
  const params = new URLSearchParams({
    startDateTime: connectorText(args.timeMin) || new Date(now).toISOString(),
    endDateTime:
      connectorText(args.timeMax) || new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString(),
    $top: String(limit),
    $select: "id,subject,bodyPreview,start,end,location,organizer,attendees,webLink",
    $orderby: "start/dateTime",
  });
  const value = await graphRequest<{ value?: unknown[] }>(`/me/calendarView?${params}`);
  return {
    connector: "microsoft_365",
    service: "calendar",
    untrustedExternalContent: true,
    events: (value.value || []).slice(0, limit).map(summarizeEvent),
  };
}

function graphRecipient(address: string): Record<string, unknown> {
  return {
    emailAddress: {
      address: address
        .replace(/[\r\n]+/g, " ")
        .trim()
        .slice(0, 320),
    },
  };
}

export async function outlookSend(args: Record<string, unknown>): Promise<unknown> {
  const to = connectorStringList(args.to).map(graphRecipient);
  if (to.length === 0) throw new Error("to is required");
  const cc = connectorStringList(args.cc).map(graphRecipient);
  const bcc = connectorStringList(args.bcc).map(graphRecipient);
  await graphRequest(
    "/me/sendMail",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: connectorRequiredString(args.subject, "subject").slice(0, 2_000),
          body: {
            contentType: "Text",
            content: connectorRequiredString(args.body, "body"),
          },
          toRecipients: to,
          ...(cc.length ? { ccRecipients: cc } : {}),
          ...(bcc.length ? { bccRecipients: bcc } : {}),
        },
        saveToSentItems: true,
      }),
    },
    true
  );
  return { connector: "microsoft_365", service: "outlook", sent: true };
}

function encodedOneDrivePath(value: string): string {
  const segments = value.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("path must identify a OneDrive file");
  }
  return segments.map(encodeURIComponent).join("/");
}

export async function oneDriveUpload(args: Record<string, unknown>): Promise<unknown> {
  const path = encodedOneDrivePath(connectorRequiredString(args.path, "path"));
  const content = connectorRequiredString(args.content, "content");
  ensureConnectorContentSize(content);
  const token = await getAccountConnectorAccessToken("microsoft_365", true);
  const response = await connectorFetch(`${GRAPH_BASE_URL}/me/drive/root:/${path}:/content`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain; charset=utf-8" },
    body: content,
  });
  const file = await parseConnectorJson<Record<string, unknown>>(response);
  return { connector: "microsoft_365", service: "onedrive", uploaded: true, file };
}

export async function microsoftCalendarCreate(args: Record<string, unknown>): Promise<unknown> {
  const start = connectorIsoDateTime(args.start, "start");
  const end = connectorIsoDateTime(args.end, "end");
  if (Date.parse(end) <= Date.parse(start)) throw new Error("end must be after start");
  const timeZone = connectorText(args.timeZone) || "UTC";
  const attendees = connectorStringList(args.attendees)
    .slice(0, 50)
    .map((email) => ({
      emailAddress: { address: email.slice(0, 320) },
      type: "required",
    }));
  const event = await graphRequest<Record<string, unknown>>(
    "/me/events",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: connectorRequiredString(args.summary, "summary").slice(0, 2_000),
        start: { dateTime: start.replace(/Z$/, ""), timeZone },
        end: { dateTime: end.replace(/Z$/, ""), timeZone },
        ...(connectorText(args.description)
          ? { body: { contentType: "Text", content: connectorText(args.description) } }
          : {}),
        ...(connectorText(args.location)
          ? { location: { displayName: connectorText(args.location) } }
          : {}),
        ...(attendees.length ? { attendees } : {}),
      }),
    },
    true
  );
  return { connector: "microsoft_365", service: "calendar", created: true, event };
}
