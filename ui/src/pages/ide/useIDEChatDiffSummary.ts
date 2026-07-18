import { useCallback, useMemo } from "react";
import {
  getIdePendingFileDecisionKey,
  mergeIdeFileChangeSummaries,
  summarizeIdeActivityFileChanges,
  summarizeIdeMessageFileChanges,
  summarizeIdeTextFileChanges,
} from "./ideDiffHelpers";
import type { IdeChatMessage, IdeFileChangeSummary, IdePendingFileDiff } from "./ideTypes";

interface IDEChatDiffSummaryOptions {
  fileDiffDecision: Record<string, "accepted" | "rejected">;
  messages: IdeChatMessage[];
  resolvedPendingDiffs: Record<string, string>;
}

export function useIDEChatDiffSummary({
  fileDiffDecision,
  messages,
  resolvedPendingDiffs,
}: IDEChatDiffSummaryOptions) {
  const getMessageKey = useCallback(
    (message: IdeChatMessage, index: number): string =>
      `${message.role}:${message.timestamp}:${index}`,
    []
  );

  const messageChangeSummaryByKey = useMemo(() => {
    const map = new Map<string, IdeFileChangeSummary>();
    messages.forEach((message, index) => {
      if (message.role !== "assistant") return;
      const toolSummary = summarizeIdeMessageFileChanges(message.tool_calls);
      const summary =
        toolSummary ||
        mergeIdeFileChangeSummaries(
          summarizeIdeActivityFileChanges(message.process_activities),
          summarizeIdeTextFileChanges(message.content)
        );
      if (summary) map.set(getMessageKey(message, index), summary);
    });
    return map;
  }, [getMessageKey, messages]);

  const resolvedFileEntriesByMessageKey = useMemo(() => {
    const map = new Map<string, IdePendingFileDiff[]>();
    for (const [messageKey, summary] of messageChangeSummaryByKey.entries()) {
      map.set(
        messageKey,
        summary.files.map((file) => {
          const fileKey = getIdePendingFileDecisionKey(messageKey, file.path);
          return {
            key: fileKey,
            messageKey,
            path: file.path,
            type: file.type,
            added: file.added,
            removed: file.removed,
            diff:
              resolvedPendingDiffs[fileKey] ||
              (typeof file.diff === "string" ? file.diff : undefined),
          } satisfies IdePendingFileDiff;
        })
      );
    }
    return map;
  }, [messageChangeSummaryByKey, resolvedPendingDiffs]);

  const pendingFileDiffs = useMemo(() => {
    const items: IdePendingFileDiff[] = [];
    for (const files of resolvedFileEntriesByMessageKey.values()) {
      for (const file of files) {
        if (!fileDiffDecision[file.key]) items.push(file);
      }
    }
    return items;
  }, [fileDiffDecision, resolvedFileEntriesByMessageKey]);

  const pendingMessageChangeKeys = useMemo(() => {
    const keys: string[] = [];
    for (const [messageKey, files] of resolvedFileEntriesByMessageKey.entries()) {
      if (files.some((file) => !fileDiffDecision[file.key])) keys.push(messageKey);
    }
    return keys;
  }, [fileDiffDecision, resolvedFileEntriesByMessageKey]);

  const pendingChangeAggregate = useMemo(() => {
    const byPath = new Map<string, { added: number; removed: number }>();
    for (const file of pendingFileDiffs) {
      const existing = byPath.get(file.path) || { added: 0, removed: 0 };
      existing.added += file.added;
      existing.removed += file.removed;
      byPath.set(file.path, existing);
    }
    const files = Array.from(byPath.values());
    return {
      fileCount: byPath.size,
      totalAdded: files.reduce((sum, file) => sum + file.added, 0),
      totalRemoved: files.reduce((sum, file) => sum + file.removed, 0),
    };
  }, [pendingFileDiffs]);

  return {
    getMessageKey,
    messageChangeSummaryByKey,
    pendingChangeAggregate,
    pendingFileDiffs,
    pendingMessageChangeKeys,
    resolvedFileEntriesByMessageKey,
  };
}
