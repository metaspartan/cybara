import { createHash, randomUUID } from "crypto";
import { basename } from "path";
import type { ChatMessage } from "../../api/chat";
import { agentManager } from "../agent";
import { hydrateImageDataFromPath, persistImageAttachments } from "../chat/attachments";
import { config } from "../config";
import { tables, type ChatSessionDB } from "../database";
import { redactSecrets } from "../redaction";
import {
  loadPersistedSession,
  persistSession,
  upsertPersistedSessionMessage,
} from "../session-context";
import type {
  NearbySessionBundle,
  NearbyTransferMessage,
  NearbyWorkspaceDescriptor,
} from "./types";

const IMPORTED_TRANSFERS_KEY = "nearby_imported_transfers";

function runGit(workspaceDir: string, args: string[]): string | undefined {
  try {
    const result = Bun.spawnSync(["git", "-C", workspaceDir, ...args], {
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode !== 0) return undefined;
    const value = result.stdout.toString().trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function workspaceDescriptor(workspaceDir: string | null): NearbyWorkspaceDescriptor | null {
  if (!workspaceDir) return null;
  const remote = runGit(workspaceDir, ["remote", "get-url", "origin"]);
  const status = runGit(workspaceDir, ["status", "--porcelain"]);
  return {
    name: basename(workspaceDir),
    gitRemoteHash: remote
      ? createHash("sha256").update(remote).digest("hex").slice(0, 24)
      : undefined,
    branch: runGit(workspaceDir, ["branch", "--show-current"]),
    commit: runGit(workspaceDir, ["rev-parse", "--short=12", "HEAD"]),
    dirty: status === undefined ? undefined : status.length > 0,
  };
}

const MAX_TRANSFER_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TRANSFER_IMAGES = 20;
const MAX_TRANSFER_MESSAGE_CHARS = 4 * 1024 * 1024;

interface TransferableImage {
  data?: string;
  url?: string;
  mimeType?: string;
}

function toTransferableImage(image: {
  data?: string;
  url?: string;
  mimeType?: string;
}): TransferableImage | null {
  const mimeType =
    typeof image.mimeType === "string" && image.mimeType.startsWith("image/")
      ? image.mimeType.slice(0, 64)
      : undefined;
  if (typeof image.data === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) {
    const byteLength = Buffer.from(image.data, "base64").length;
    if (byteLength > 0 && byteLength <= MAX_TRANSFER_IMAGE_BYTES) {
      return { data: image.data, mimeType };
    }
  }
  if (typeof image.url === "string") {
    try {
      if (new URL(image.url).protocol === "https:") return { url: image.url, mimeType };
    } catch {}
  }
  return null;
}

function portableMessage(message: ChatMessage): NearbyTransferMessage {
  const images = message.images
    ?.map((image) => toTransferableImage(hydrateImageDataFromPath(image)))
    .filter((image): image is TransferableImage => image !== null)
    .slice(0, MAX_TRANSFER_IMAGES);
  const content =
    typeof message.content === "string" ? message.content.slice(0, MAX_TRANSFER_MESSAGE_CHARS) : "";
  const redacted = redactSecrets({
    role: message.role,
    content,
    timestamp: message.timestamp,
    provider: message.provider,
    provider_id: message.provider_id,
    provider_name: message.provider_name,
    model: message.model,
    agent_id: message.agent_id,
    agent_name: message.agent_name,
    agent_type: message.agent_type,
    thinking: message.thinking,
    tool_calls: message.tool_calls,
    process_activities: message.process_activities,
    agent_transfers: message.agent_transfers,
    images,
    image_context: message.image_context,
  });
  return redacted as NearbyTransferMessage;
}

function sessionRow(sessionId: string): ChatSessionDB | null {
  const rows = tables.chatSessions.all() as ChatSessionDB[];
  return rows.find((row) => row.id === sessionId) ?? null;
}

export async function createNearbySessionBundle(sessionId: string): Promise<NearbySessionBundle> {
  const session = await loadPersistedSession(sessionId);
  if (!session) throw new Error("Chat session not found");
  const row = sessionRow(sessionId);
  const createdAt = row?.created_at || new Date().toISOString();
  return {
    protocol: "cybara-nearby-v1",
    kind: "session",
    transferId: randomUUID(),
    sourceSessionId: sessionId,
    title: session.title,
    sourceAgentId: session.agentId,
    createdAt,
    updatedAt: row?.updated_at || createdAt,
    workspace: workspaceDescriptor(session.workspaceDir),
    messages: session.messages.filter((message) => message.role !== "system").map(portableMessage),
  };
}

function importedTransferIds(): string[] {
  const stored = config.get<unknown>(IMPORTED_TRANSFERS_KEY);
  return Array.isArray(stored)
    ? stored.filter((value): value is string => typeof value === "string").slice(-500)
    : [];
}

function rememberImportedTransfer(transferId: string): void {
  config.set(
    IMPORTED_TRANSFERS_KEY,
    [...new Set([...importedTransferIds(), transferId])].slice(-500)
  );
}

function resolveImportedAgentId(sourceAgentId: string): string {
  if (agentManager.get(sourceAgentId)) return sourceAgentId;
  const first = agentManager.list()[0];
  return first?.id || "default";
}

export async function importNearbySessionBundle(
  bundle: NearbySessionBundle,
  workspaceDir?: string | null
): Promise<{ sessionId: string; duplicate: boolean }> {
  if (importedTransferIds().includes(bundle.transferId)) {
    const existing = (tables.chatSessions.all() as ChatSessionDB[]).find((row) => {
      const messages = tables.sessionMessages.getBySession(row.id) as Array<{
        metadata?: string | null;
      }>;
      return messages.some((message) => message.metadata?.includes(bundle.transferId));
    });
    return { sessionId: existing?.id || bundle.sourceSessionId, duplicate: true };
  }
  const sessionId = randomUUID();
  const agentId = resolveImportedAgentId(bundle.sourceAgentId);
  const messages = bundle.messages.map((message) => ({ ...message })) as ChatMessage[];
  const persisted = await persistSession(
    sessionId,
    agentId,
    messages,
    workspaceDir ?? null,
    bundle.title
  );
  if (!persisted) throw new Error("Unable to import the chat session");
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const images = message.images || [];
    const attachments = images.length ? persistImageAttachments(sessionId, images) : [];
    await upsertPersistedSessionMessage(
      sessionId,
      agentId,
      { ...message, images: undefined },
      {
        stableKey: `${bundle.transferId}:${index}`,
        createdAtOffsetMs: index,
        metadata: {
          nearby_transfer_id: bundle.transferId,
          nearby_source_session_id: bundle.sourceSessionId,
          ...(attachments.length ? { attachments } : {}),
        },
      }
    );
  }
  rememberImportedTransfer(bundle.transferId);
  return { sessionId, duplicate: false };
}
