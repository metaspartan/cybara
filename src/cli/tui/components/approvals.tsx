import React from "react";
import { Box, Text } from "ink";

export type ToolApprovalDecision =
  | "approve_once"
  | "approve_session"
  | "approve_always"
  | "deny";

export interface ToolApprovalRequest {
  id: string;
  sessionId: string;
  toolName: string;
  argsPreview: string;
  createdAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function approvalsFromResponse(value: unknown): ToolApprovalRequest[] {
  const raw = isRecord(value) && Array.isArray(value.pending) ? value.pending : [];
  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (
      typeof item.id !== "string" ||
      typeof item.sessionId !== "string" ||
      typeof item.toolName !== "string"
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        sessionId: item.sessionId,
        toolName: item.toolName,
        argsPreview: typeof item.argsPreview === "string" ? item.argsPreview : "",
        createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
      },
    ];
  });
}

export function approvalDecisionForInput(input: string): ToolApprovalDecision | null {
  const normalized = input.toLowerCase();
  if (normalized === "1" || normalized === "y") return "approve_once";
  if (normalized === "2" || normalized === "s") return "approve_session";
  if (normalized === "3" || normalized === "a") return "approve_always";
  if (normalized === "4" || normalized === "n" || normalized === "d") return "deny";
  return null;
}

function compact(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

export function ToolApprovalPrompt({
  request,
  resolving,
  queuedCount,
}: {
  request: ToolApprovalRequest;
  resolving: boolean;
  queuedCount: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="yellow">
          Approval required · {request.toolName}
        </Text>
        {queuedCount > 1 ? <Text color="gray">1 of {queuedCount}</Text> : null}
      </Box>
      {request.argsPreview ? <Text color="gray">{compact(request.argsPreview, 120)}</Text> : null}
      <Text>
        <Text color="cyan">[1/y]</Text> once · <Text color="cyan">[2/s]</Text> session ·{" "}
        <Text color="cyan">[3/a]</Text> always · <Text color="red">[4/n]</Text> deny
      </Text>
      {resolving ? <Text color="yellow">Resolving approval…</Text> : null}
    </Box>
  );
}
