import {
  appendArtifact,
  checkArtifactItem,
  createArtifact,
  deleteArtifact,
  listArtifacts,
  readArtifact,
  updateArtifact,
  type ArtifactSummary,
  type ArtifactKind,
} from "../../artifacts";
import { trackMetric } from "../../metrics";
import type { ToolContext } from "../index";

const ALLOWED_ARTIFACT_KINDS = new Set<ArtifactKind>([
  "task",
  "implementation",
  "walkthrough",
  "notes",
  "custom",
]);

type ArtifactAction = "list" | "read" | "create" | "update" | "append" | "delete" | "check";

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function resolveSessionId(args: Record<string, unknown>, context?: ToolContext): string {
  const fromArgs = asString(args.sessionId);
  if (fromArgs) return fromArgs;
  const fromContext = asString(context?.sessionId);
  if (fromContext) return fromContext;
  throw new Error(
    "Validation error: artifacts tool requires a sessionId. Use this tool from an active chat session or pass sessionId explicitly."
  );
}

function resolveArtifactKind(args: Record<string, unknown>): ArtifactKind | undefined {
  const kind = asString(args.kind) || asString(args.type);
  if (!kind) return undefined;
  if (!ALLOWED_ARTIFACT_KINDS.has(kind as ArtifactKind)) {
    throw new Error(
      `Validation error: Unsupported artifact kind '${kind}'. Use task, implementation, walkthrough, notes, or custom.`
    );
  }
  return kind as ArtifactKind;
}

function resolveArtifactName(args: Record<string, unknown>): string {
  const name =
    asString(args.name) ||
    asString(args.artifact) ||
    asString(args.artifactName) ||
    asString(args.fileName) ||
    asString(args.kind) ||
    asString(args.type);
  if (!name) {
    throw new Error("Validation error: artifact name is required");
  }
  return name;
}

function previewText(value: string, max = 240): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function normalizeAction(args: Record<string, unknown>): ArtifactAction {
  const actionRaw = (asString(args.action) || "list").toLowerCase();
  const aliases: Record<string, ArtifactAction> = {
    ls: "list",
    get: "read",
    create_or_update: "update",
    append_text: "append",
    remove: "delete",
    complete: "check",
  };
  const normalized = (aliases[actionRaw] || actionRaw) as ArtifactAction;
  const allowed: ArtifactAction[] = [
    "list",
    "read",
    "create",
    "update",
    "append",
    "delete",
    "check",
  ];
  if (!allowed.includes(normalized)) {
    throw new Error(
      "Validation error: Unsupported artifacts action. Use list, read, create, update, append, delete, or check."
    );
  }
  return normalized;
}

function isArtifactNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Artifact not found:");
}

function normalizeArtifactLookupKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.md\.resolved$/i, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pickFallbackArtifact(
  requestedName: string,
  kindHint: ArtifactKind | undefined,
  artifacts: ArtifactSummary[]
): ArtifactSummary | undefined {
  if (artifacts.length === 0) return undefined;

  const normalizedRequested = normalizeArtifactLookupKey(requestedName);
  const exact = artifacts.find(
    (artifact) =>
      artifact.name.toLowerCase() === normalizedRequested ||
      artifact.fileName.toLowerCase() === `${normalizedRequested}.md.resolved`
  );
  if (exact) return exact;

  if (normalizedRequested) {
    const prefixed = artifacts.find((artifact) =>
      artifact.name.toLowerCase().startsWith(`${normalizedRequested}-`)
    );
    if (prefixed) return prefixed;
  }

  if (kindHint) {
    const sameKind = artifacts.find((artifact) => artifact.kind === kindHint);
    if (sameKind) return sameKind;
  }

  return artifacts[0];
}

export async function handleArtifacts(
  args: Record<string, unknown>,
  context?: ToolContext
): Promise<unknown> {
  const action = normalizeAction(args);
  const sessionId = resolveSessionId(args, context);
  trackMetric("artifact_operation", action, 1, {
    sessionId,
    agentId: context?.agentId,
  });

  if (action === "list") {
    const artifacts = listArtifacts(sessionId);
    return {
      action,
      sessionId,
      count: artifacts.length,
      artifacts,
    };
  }

  if (action === "read") {
    const name = resolveArtifactName(args);
    const maxChars = asNumber(args.maxChars) || asNumber(args.limit);
    const kindHint = resolveArtifactKind(args);
    try {
      const result = readArtifact({ sessionId, name, maxChars });
      return {
        action,
        sessionId,
        artifact: result.artifact,
        content: result.content,
        preview: previewText(result.content),
        truncated: result.truncated,
        totalChars: result.totalChars,
      };
    } catch (error) {
      if (!isArtifactNotFoundError(error)) {
        throw error;
      }

      const availableArtifacts = listArtifacts(sessionId);
      const fallbackArtifact = pickFallbackArtifact(name, kindHint, availableArtifacts);
      if (fallbackArtifact) {
        const result = readArtifact({
          sessionId,
          name: fallbackArtifact.name,
          maxChars,
        });
        return {
          action,
          sessionId,
          artifact: result.artifact,
          content: result.content,
          preview: previewText(result.content),
          truncated: result.truncated,
          totalChars: result.totalChars,
          fallback: true,
          resolvedFrom: name,
          availableArtifacts,
        };
      }

      return {
        action,
        sessionId,
        missing: true,
        requestedName: name,
        error: error instanceof Error ? error.message : "Artifact not found",
        count: availableArtifacts.length,
        artifacts: availableArtifacts,
        content: "",
        preview: "",
        truncated: false,
        totalChars: 0,
      };
    }
  }

  if (action === "create") {
    const kind = resolveArtifactKind(args) || "custom";
    const title = asString(args.title);
    const content = asString(args.content);
    const overwrite = args.overwrite === true;
    const rawItems = Array.isArray(args.items)
      ? args.items.filter((entry): entry is string => typeof entry === "string")
      : undefined;

    const result = createArtifact({
      sessionId,
      kind,
      name: asString(args.name),
      title,
      content,
      items: rawItems,
      overwrite,
    });

    return {
      action,
      sessionId,
      artifact: result.artifact,
      created: result.created,
      preview: content ? previewText(content) : undefined,
    };
  }

  if (action === "update") {
    const name = resolveArtifactName(args);
    const content = asString(args.content);
    if (!content) {
      throw new Error("Validation error: content is required");
    }
    const result = updateArtifact({
      sessionId,
      name,
      content,
    });
    return {
      action,
      sessionId,
      artifact: result.artifact,
      updated: result.updated,
      preview: previewText(content),
    };
  }

  if (action === "append") {
    const name = resolveArtifactName(args);
    const content = asString(args.content);
    if (!content) {
      throw new Error("Validation error: content is required");
    }
    const result = appendArtifact({
      sessionId,
      name,
      content,
    });
    return {
      action,
      sessionId,
      artifact: result.artifact,
      appended: result.appended,
      preview: previewText(content),
    };
  }

  if (action === "delete") {
    const name = resolveArtifactName(args);
    const result = deleteArtifact({
      sessionId,
      name,
    });
    return {
      action,
      ...result,
    };
  }

  const name = resolveArtifactName(args);
  const item = asNumber(args.item);
  if (!item) {
    throw new Error("Validation error: item is required for check action");
  }
  const checked = args.checked !== false;
  const result = checkArtifactItem({
    sessionId,
    name,
    item,
    checked,
  });
  return {
    action,
    sessionId,
    artifact: result.artifact,
    updatedLine: result.updatedLine,
    checked: result.checked,
  };
}
