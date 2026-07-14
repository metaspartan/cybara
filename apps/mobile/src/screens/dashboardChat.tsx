import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  FileText,
  Folder,
  Globe2,
  ListChecks,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  SquareTerminal,
  User,
} from "lucide-react-native";
import { colors } from "../theme/liquidGlass";
import { styles } from "./dashboardStyles";
import { relativeTimestamp } from "./dashboardHelpers";
import {
  buildMobileWorkTimeline,
  groupMobileActivities,
  type MobileWorkActivity,
  type MobileActivityGroupKind,
  hasUnicodeTextFallback,
  parseMarkdownBlocks,
  parseInlineMarkdown,
  splitMessageContent,
  type MarkdownInline,
} from "../lib/chat-format";
import type { SessionDetailSummary, SessionMessageSummary, SessionPlanSnapshot } from "../lib/api";
import { Clipboard } from "../lib/expoNativeModules";
import {
  getChatCodeFontSizePixels,
  getChatFontSizePixels,
  getChatLineHeight,
  type ChatAppearanceSettings,
} from "cybara-shared/chat-appearance";

const MOBILE_GROUP_ICONS: Record<MobileActivityGroupKind, typeof FileText> = {
  read: FileText,
  search: Search,
  list: Folder,
  edit: Pencil,
  fetch: Globe2,
  command: SquareTerminal,
};

interface MobileFileChangeItem {
  path: string;
  fileName: string;
  parentPath: string | null;
  added: number;
  removed: number;
}

function mobileFilePathDisplay(path: string): { fileName: string; parentPath: string | null } {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const fileName = segments.pop() || normalized || "file";
  if (segments.length === 0) return { fileName, parentPath: null };
  const parentTail = segments.slice(-2).join("/");
  return {
    fileName,
    parentPath: segments.length > 2 ? `.../${parentTail}` : parentTail,
  };
}

function mobileFilePathKey(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

function mobileActivityFileChange(text: string, phase: string): MobileFileChangeItem | null {
  if ((phase || "result").toLowerCase() !== "result") return null;
  const match = text.trim().match(/^Edited\s+(.+?)\s+\+(\d+)\s+-(\d+)$/i);
  if (!match) return null;
  const path = match[1]?.trim() || "";
  if (!path || path.toLowerCase() === "file") return null;
  const added = Number.parseInt(match[2] || "0", 10);
  const removed = Number.parseInt(match[3] || "0", 10);
  if (!Number.isFinite(added) || !Number.isFinite(removed)) return null;
  const display = mobileFilePathDisplay(path);
  return {
    path,
    fileName: display.fileName,
    parentPath: display.parentPath,
    added: Math.max(0, added),
    removed: Math.max(0, removed),
  };
}

function collectMobileFileChanges(
  message: SessionDetailSummary["messages"][number]
): { files: MobileFileChangeItem[]; totalAdded: number; totalRemoved: number } | null {
  const byPath = new Map<string, MobileFileChangeItem>();
  for (const activity of message.processActivities || []) {
    const parsed = mobileActivityFileChange(activity.text || "", activity.phase || "result");
    if (!parsed) continue;
    const key = mobileFilePathKey(parsed.path);
    const existing = byPath.get(key);
    if (existing) {
      existing.added += parsed.added;
      existing.removed += parsed.removed;
    } else {
      byPath.set(key, parsed);
    }
  }
  for (const toolCall of message.toolCalls || []) {
    if (!toolCall.filePath) continue;
    const toolPathKey = mobileFilePathKey(toolCall.filePath);
    const matchingKey = Array.from(byPath.keys()).find(
      (key) =>
        key === toolPathKey || toolPathKey.endsWith(`/${key}`) || key.endsWith(`/${toolPathKey}`)
    );
    const display = mobileFilePathDisplay(toolCall.filePath);
    if (matchingKey) {
      const existing = byPath.get(matchingKey);
      if (existing && toolCall.filePath.length >= existing.path.length) {
        byPath.delete(matchingKey);
        byPath.set(toolPathKey, {
          ...existing,
          path: toolCall.filePath,
          fileName: display.fileName,
          parentPath: display.parentPath,
        });
      }
    } else {
      byPath.set(toolPathKey, {
        path: toolCall.filePath,
        fileName: display.fileName,
        parentPath: display.parentPath,
        added: 0,
        removed: 0,
      });
    }
  }
  const files = Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0) return null;
  return {
    files,
    totalAdded: files.reduce((sum, file) => sum + file.added, 0),
    totalRemoved: files.reduce((sum, file) => sum + file.removed, 0),
  };
}

function InlineMarkdown({
  appearance,
  selectable = false,
  tokens,
}: {
  appearance: ChatAppearanceSettings;
  selectable?: boolean;
  tokens: MarkdownInline[];
}) {
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.type) {
          case "bold":
            return (
              <Text key={index} selectable={selectable} style={styles.mdBold}>
                {token.text}
              </Text>
            );
          case "italic":
            return (
              <Text key={index} selectable={selectable} style={styles.mdItalic}>
                {token.text}
              </Text>
            );
          case "strike":
            return (
              <Text key={index} selectable={selectable} style={styles.mdStrike}>
                {token.text}
              </Text>
            );
          case "code":
            return (
              <Text
                key={index}
                selectable={selectable}
                style={[
                  styles.mdInlineCode,
                  { fontSize: getChatCodeFontSizePixels(appearance.codeFontSize) },
                ]}
              >
                {token.text}
              </Text>
            );
          case "link":
            return (
              <Text
                key={index}
                selectable={selectable}
                style={[
                  styles.mdLink,
                  { textDecorationLine: appearance.underlineLinks ? "underline" : "none" },
                ]}
                onPress={() => {
                  void Linking.openURL(token.href).catch(() => {});
                }}
              >
                {token.text}
              </Text>
            );
          default:
            return (
              <Text key={index} selectable={selectable}>
                {token.text}
              </Text>
            );
        }
      })}
    </>
  );
}

function MarkdownText({
  appearance,
  content,
}: {
  appearance: ChatAppearanceSettings;
  content: string;
}) {
  const blocks = parseMarkdownBlocks(content);
  const fontSize = getChatFontSizePixels(appearance.fontSize);
  const lineHeight = Math.round(fontSize * getChatLineHeight(appearance.lineSpacing));
  const bodyStyle: TextStyle = { fontSize, lineHeight };
  return (
    <View style={styles.mdBlocks}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <Text
                key={index}
                selectable
                style={[
                  block.level === 1 ? styles.mdH1 : block.level === 2 ? styles.mdH2 : styles.mdH3,
                  { fontSize: fontSize + (block.level === 1 ? 8 : block.level === 2 ? 5 : 2) },
                ]}
              >
                <InlineMarkdown appearance={appearance} tokens={block.inline} />
              </Text>
            );
          case "listItem":
            return (
              <View key={index} style={styles.mdListRow}>
                <Text selectable style={[styles.mdListMarker, bodyStyle]}>
                  {block.marker}
                </Text>
                <Text selectable style={[styles.mdListText, bodyStyle]}>
                  <InlineMarkdown appearance={appearance} tokens={block.inline} />
                </Text>
              </View>
            );
          case "quote":
            return (
              <View key={index} style={styles.mdQuote}>
                <Text selectable style={[styles.mdQuoteText, bodyStyle]}>
                  <InlineMarkdown appearance={appearance} tokens={block.inline} />
                </Text>
              </View>
            );
          case "rule":
            return <View key={index} style={styles.mdRule} />;
          case "table":
            return (
              <ScrollView key={index} horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.mdTable}>
                  <View style={styles.mdTableHeaderRow}>
                    {block.header.map((cell, cellIndex) => (
                      <View key={cellIndex} style={styles.mdTableCell}>
                        <Text selectable style={styles.mdTableHeaderText}>
                          <InlineMarkdown appearance={appearance} tokens={cell} />
                        </Text>
                      </View>
                    ))}
                  </View>
                  {block.rows.map((row, rowIndex) => (
                    <View key={rowIndex} style={styles.mdTableRow}>
                      {row.map((cell, cellIndex) => (
                        <View key={cellIndex} style={styles.mdTableCell}>
                          <Text selectable style={styles.mdTableCellText}>
                            <InlineMarkdown appearance={appearance} tokens={cell} />
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          default:
            return (
              <Text key={index} selectable style={[styles.mdParagraph, bodyStyle]}>
                <InlineMarkdown appearance={appearance} tokens={block.inline} />
              </Text>
            );
        }
      })}
    </View>
  );
}

function MessageActionsRow({
  alignEnd,
  content,
  onAddToChat,
  timestampLabel,
  onRevert,
}: {
  alignEnd?: boolean;
  content: string;
  onAddToChat?: (content: string) => void;
  timestampLabel?: string | null;
  onRevert?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={[styles.messageActionsRow, alignEnd && styles.messageActionsRowEnd]}>
      {timestampLabel ? <Text style={styles.messageTime}>{timestampLabel}</Text> : null}
      <Pressable
        accessibilityLabel="Copy message"
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => {
          void Clipboard.setStringAsync(content)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {});
        }}
        style={styles.messageActionButton}
      >
        {copied ? (
          <Check color={colors.green} size={13} strokeWidth={2.2} />
        ) : (
          <Copy color={colors.textDim} size={13} strokeWidth={2.2} />
        )}
      </Pressable>
      {onAddToChat && content.trim() ? (
        <Pressable
          accessibilityLabel="Add message to chat"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onAddToChat(content)}
          style={styles.messageActionButton}
        >
          <ListChecks color={colors.textDim} size={13} strokeWidth={2.2} />
        </Pressable>
      ) : null}
      {onRevert ? (
        <Pressable
          accessibilityLabel="Revert session to this message"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onRevert}
          style={styles.messageActionButton}
        >
          <RotateCcw color={colors.textDim} size={13} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </View>
  );
}

function resolveUserImageUri(
  image: NonNullable<SessionMessageSummary["images"]>[number]
): string | null {
  if (image.url && image.url.trim()) return image.url.trim();
  if (image.data && image.data.trim()) {
    return `data:${image.mimeType || "image/png"};base64,${image.data.trim()}`;
  }
  return null;
}

function ChatImage({ uri }: { uri: string }) {
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  useEffect(() => {
    let active = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (active && width > 0 && height > 0) setAspectRatio(width / height);
      },
      () => {}
    );
    return () => {
      active = false;
    };
  }, [uri]);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      onPress={() => {
        void Linking.openURL(uri).catch(() => {});
      }}
      style={styles.chatImageWrapper}
    >
      <Image resizeMode="cover" source={{ uri }} style={[styles.chatImage, { aspectRatio }]} />
    </Pressable>
  );
}

function ChatImageAttachments({ uris }: { uris: string[] }) {
  if (uris.length === 0) return null;
  return (
    <View style={styles.chatImageList}>
      {uris.map((uri, index) => (
        <ChatImage key={`${uri}-${index}`} uri={uri} />
      ))}
    </View>
  );
}

function mobilePlanProgressLabel(plan: SessionPlanSnapshot): string {
  if (plan.summary.total === 0) return "No tasks";
  return `${plan.summary.completed}/${plan.summary.total} complete`;
}

function mobileCurrentPlanItem(plan: SessionPlanSnapshot): string {
  return (
    plan.items.find((item) => item.status === "in_progress")?.content ||
    plan.items.find((item) => item.status === "pending")?.content ||
    plan.items[plan.items.length - 1]?.content ||
    "No active task"
  );
}

function MobilePlanStatusIcon({
  status,
}: {
  status: SessionPlanSnapshot["items"][number]["status"];
}) {
  if (status === "completed") {
    return <CheckCircle2 color={colors.textMuted} size={13} strokeWidth={2.2} />;
  }
  if (status === "in_progress") {
    return <Loader2 color={colors.textMuted} size={13} strokeWidth={2.2} />;
  }
  return <View style={styles.mobilePlanPendingDot} />;
}

function MobileFileChangesCard({
  summary,
}: {
  summary: { files: MobileFileChangeItem[]; totalAdded: number; totalRemoved: number };
}) {
  return (
    <View style={styles.mobileFileChangesCard}>
      <View style={styles.mobileFileChangesHeader}>
        <FileText color={colors.textMuted} size={13} strokeWidth={2.2} />
        <Text selectable style={styles.mobileFileChangesTitle}>
          {summary.files.length} files changed
        </Text>
        <Text selectable style={styles.mobileFileChangesAdded}>
          +{summary.totalAdded}
        </Text>
        <Text selectable style={styles.mobileFileChangesRemoved}>
          -{summary.totalRemoved}
        </Text>
      </View>
      {summary.files.slice(0, 4).map((file) => (
        <View key={file.path} style={styles.mobileFileChangeRow}>
          <View style={styles.mobileFileChangeNameColumn}>
            <Text selectable numberOfLines={1} style={styles.mobileFileChangeName}>
              {file.fileName}
            </Text>
            {file.parentPath ? (
              <Text selectable numberOfLines={1} style={styles.mobileFileChangePath}>
                {file.parentPath}
              </Text>
            ) : null}
          </View>
          <View style={styles.mobileFileChangeCounts}>
            <Text selectable style={styles.mobileFileChangesAdded}>
              +{file.added}
            </Text>
            <Text selectable style={styles.mobileFileChangesRemoved}>
              -{file.removed}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function MobilePlanSummaryCard({ plan }: { plan: SessionPlanSnapshot }) {
  const [expanded, setExpanded] = useState(false);
  const progressPercent =
    plan.summary.total > 0 ? Math.round((plan.summary.completed / plan.summary.total) * 100) : 0;
  return (
    <View style={styles.mobilePlanCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Collapse session plan" : "Expand session plan"}
        onPress={() => setExpanded((value) => !value)}
        style={styles.mobilePlanHeader}
      >
        <View style={styles.mobilePlanIcon}>
          <ListChecks color={colors.textMuted} size={15} strokeWidth={2.2} />
        </View>
        <View style={styles.mobilePlanHeaderText}>
          <View style={styles.mobilePlanTitleRow}>
            <Text selectable style={styles.mobilePlanTitle}>
              Latest plan update
            </Text>
            <Text selectable style={styles.mobilePlanProgressText}>
              {mobilePlanProgressLabel(plan)}
            </Text>
          </View>
          <Text numberOfLines={1} selectable style={styles.mobilePlanCurrentTask}>
            {mobileCurrentPlanItem(plan)}
          </Text>
        </View>
        {expanded ? (
          <ChevronUp color={colors.textMuted} size={15} strokeWidth={2.2} />
        ) : (
          <ChevronDown color={colors.textMuted} size={15} strokeWidth={2.2} />
        )}
      </Pressable>
      <View style={styles.mobilePlanProgressTrack}>
        <View style={[styles.mobilePlanProgressFill, { width: `${progressPercent}%` }]} />
      </View>
      {expanded ? (
        <View style={styles.mobilePlanItems}>
          {plan.items.map((item, index) => (
            <View key={`${item.status}-${index}-${item.content}`} style={styles.mobilePlanItem}>
              <View style={styles.mobilePlanItemIcon}>
                <MobilePlanStatusIcon status={item.status} />
              </View>
              <Text
                selectable
                style={[
                  styles.mobilePlanItemText,
                  item.status === "completed" && styles.mobilePlanItemTextDone,
                ]}
              >
                {item.content}
              </Text>
              <Text selectable style={styles.mobilePlanPriority}>
                {item.priority}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function ChatMessageRow({
  accentColor,
  appearance,
  message,
  nowMs,
  onAddToChat,
  onRevert,
  mediaUrl,
}: {
  accentColor: string;
  appearance: ChatAppearanceSettings;
  message: SessionDetailSummary["messages"][number];
  nowMs?: number;
  onAddToChat?: (content: string) => void;
  onRevert?: (message: SessionDetailSummary["messages"][number]) => void;
  mediaUrl?: (filePath: string) => string;
}) {
  const toolImageUris = mediaUrl
    ? (message.toolCalls || [])
        .filter((toolCall) => Boolean(toolCall.filePath))
        .map((toolCall) => mediaUrl(toolCall.filePath as string))
    : [];
  const userImageUris = (message.images || [])
    .map(resolveUserImageUri)
    .filter((uri): uri is string => uri !== null);
  const isUser = message.role === "user";
  if (!isUser) {
    const hasWorkTimeline = Boolean(
      message.thinking ||
        message.processActivities?.length ||
        message.toolCalls?.length ||
        message.agentTransfers?.length
    );
    const isLiveMessage =
      typeof message.id === "string" && message.id.startsWith("live-assistant-");
    const fileChanges = collectMobileFileChanges(message);
    if (isLiveMessage) {
      return (
        <View style={styles.agentMessageRow}>
          <WorkTimeline appearance={appearance} message={message} nowMs={nowMs} live />
          {fileChanges ? <MobileFileChangesCard summary={fileChanges} /> : null}
          <ChatImageAttachments uris={toolImageUris} />
        </View>
      );
    }
    const content = message.content || "";
    const hasContent = content.trim().length > 0;
    return (
      <View style={styles.agentMessageRow}>
        {hasWorkTimeline ? (
          <WorkTimeline appearance={appearance} message={message} nowMs={nowMs} />
        ) : null}
        <MobileAgentTransferTimeline transfers={message.agentTransfers} />
        <ChatImageAttachments uris={toolImageUris} />
        {hasContent || !hasWorkTimeline ? (
          <MessageContent
            appearance={appearance}
            content={hasContent ? content : "(empty message)"}
          />
        ) : null}
        {fileChanges ? <MobileFileChangesCard summary={fileChanges} /> : null}
        <MessageActionsRow
          content={message.content || ""}
          onAddToChat={onAddToChat}
          timestampLabel={message.timestamp ? relativeTimestamp(message.timestamp) : null}
        />
      </View>
    );
  }
  return (
    <View style={[styles.chatMessageRow, styles.chatMessageRowUser]}>
      <View style={[styles.chatAvatar, { backgroundColor: `${accentColor}22` }]}>
        <User color={accentColor} size={16} strokeWidth={2.2} />
      </View>
      <View style={styles.userMessageColumn}>
        <View
          style={[
            styles.messageBubble,
            styles.userMessageBubble,
            { borderColor: `${accentColor}55` },
          ]}
        >
          <MessageContent appearance={appearance} content={message.content || "(empty message)"} />
          <ChatImageAttachments uris={userImageUris} />
        </View>
        <MessageActionsRow
          alignEnd
          content={message.content || ""}
          onAddToChat={onAddToChat}
          timestampLabel={message.timestamp ? relativeTimestamp(message.timestamp) : null}
          onRevert={onRevert ? () => onRevert(message) : undefined}
        />
      </View>
    </View>
  );
}

function MobileAgentTransferTimeline({
  transfers,
}: {
  transfers: SessionMessageSummary["agentTransfers"];
}) {
  if (!transfers?.length) return null;
  return (
    <View style={styles.messageActivityList}>
      {transfers.map((transfer) => (
        <View
          key={`${transfer.fromAgentId}-${transfer.toAgentId}-${transfer.requestedAt || "transfer"}`}
          style={styles.messageActivityRow}
        >
          <View style={styles.messageActivityIcon}>
            <ArrowRightLeft color={colors.textMuted} size={13} strokeWidth={2.2} />
          </View>
          <Text selectable style={styles.messageActivityText}>
            Transferred from {transfer.fromAgentName} to {transfer.toAgentName}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function WorkActivityIcon({ phase, toolName }: { phase: string; toolName?: string }) {
  if (toolName === "__thought") {
    return <View style={styles.messageActivityDot} />;
  }
  if (toolName === "sessions_transfer") {
    return <ArrowRightLeft color={colors.textMuted} size={13} strokeWidth={2.2} />;
  }
  if (phase === "start") {
    return <Loader2 color={colors.textMuted} size={13} strokeWidth={2.2} />;
  }
  if (phase === "error") {
    return <AlertTriangle color={colors.textMuted} size={13} strokeWidth={2.2} />;
  }
  if (phase === "blocked") {
    return <AlertTriangle color={colors.textMuted} size={13} strokeWidth={2.2} />;
  }
  return <CheckCircle2 color={colors.textMuted} size={13} strokeWidth={2.2} />;
}

function MobileActivityRow({
  activity,
  appearance,
}: {
  activity: MobileWorkActivity;
  appearance: ChatAppearanceSettings;
}) {
  const fontSize = Math.max(11, getChatFontSizePixels(appearance.fontSize) * 0.84);
  return (
    <View style={styles.messageActivityRow}>
      <View style={styles.messageActivityIcon}>
        <WorkActivityIcon phase={activity.phase} toolName={activity.toolName} />
      </View>
      <Text
        numberOfLines={activity.toolName === "__thought" ? 3 : 2}
        selectable
        style={[
          styles.messageActivityText,
          activity.toolName === "__thought" && styles.messageThoughtText,
          {
            color: appearance.highContrast ? colors.text : colors.textMuted,
            fontSize,
            lineHeight: Math.round(fontSize * getChatLineHeight(appearance.lineSpacing)),
          },
        ]}
      >
        <InlineMarkdown appearance={appearance} tokens={parseInlineMarkdown(activity.text)} />
      </Text>
    </View>
  );
}

export function WorkTimeline({
  appearance,
  live = false,
  message,
  nowMs,
}: {
  appearance: ChatAppearanceSettings;
  live?: boolean;
  message: SessionDetailSummary["messages"][number];
  nowMs?: number;
}) {
  const timeline = buildMobileWorkTimeline(message, nowMs);
  const [expanded, setExpanded] = useState(live);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setExpanded(live);
  }, [live]);
  if (timeline.activities.length === 0) return null;

  const entries = groupMobileActivities(timeline.activities);
  const fontSize = Math.max(11, getChatFontSizePixels(appearance.fontSize) * 0.84);
  const activityStyle: TextStyle = {
    color: appearance.highContrast ? colors.text : colors.textMuted,
    fontSize,
    lineHeight: Math.round(fontSize * getChatLineHeight(appearance.lineSpacing)),
  };

  return (
    <View style={styles.workTimeline}>
      {live ? (
        <View style={styles.workTimelineHeader}>
          <Text selectable style={[styles.workedForText, activityStyle]}>
            Working for {timeline.workedDuration}
          </Text>
        </View>
      ) : (
        <Pressable
          accessibilityLabel={expanded ? "Hide work details" : "Show work details"}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={styles.workTimelineHeader}
        >
          {expanded ? (
            <ChevronDown color={colors.textMuted} size={13} strokeWidth={2.2} />
          ) : (
            <ChevronRight color={colors.textMuted} size={13} strokeWidth={2.2} />
          )}
          <Text style={[styles.workedForText, activityStyle]}>
            Worked for {timeline.workedDuration}
          </Text>
        </Pressable>
      )}
      {live || expanded ? (
        <View style={styles.messageActivityList}>
          {entries.map((entry) => {
            if (entry.type === "single") {
              return (
                <MobileActivityRow
                  key={entry.activity.id}
                  activity={entry.activity}
                  appearance={appearance}
                />
              );
            }
            const groupExpanded = expandedGroups[entry.id] === true;
            const GroupIcon = MOBILE_GROUP_ICONS[entry.kind];
            return (
              <View key={entry.id}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: groupExpanded }}
                  onPress={() =>
                    setExpandedGroups((previous) => ({
                      ...previous,
                      [entry.id]: !groupExpanded,
                    }))
                  }
                  style={styles.messageActivityRow}
                >
                  <View style={styles.messageActivityIcon}>
                    <GroupIcon color={colors.textMuted} size={13} strokeWidth={2.2} />
                  </View>
                  <Text selectable style={[styles.messageActivityGroupLabel, activityStyle]}>
                    {entry.label} {groupExpanded ? "▾" : "▸"}
                  </Text>
                </Pressable>
                {groupExpanded ? (
                  <View style={styles.messageActivityGroupItems}>
                    {entry.items.map((activity) => (
                      <MobileActivityRow
                        key={activity.id}
                        activity={activity}
                        appearance={appearance}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

export function MessageContent({
  appearance,
  content,
}: {
  appearance: ChatAppearanceSettings;
  content: string;
}) {
  return (
    <View style={styles.messageContent}>
      {splitMessageContent(content).map((part, index) =>
        part.type === "code" ? (
          <View key={`code-${index}`} style={styles.codeBlock}>
            <Text selectable style={styles.codeHeader}>
              {part.language}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <UnicodeText
                content={part.content}
                style={[
                  styles.codeText,
                  !hasUnicodeTextFallback(part.content) && styles.codeTextMonospace,
                  {
                    fontSize: getChatCodeFontSizePixels(appearance.codeFontSize),
                    lineHeight: Math.round(
                      getChatCodeFontSizePixels(appearance.codeFontSize) *
                        getChatLineHeight(appearance.lineSpacing)
                    ),
                  },
                ]}
              />
            </ScrollView>
          </View>
        ) : part.content.trim().length > 0 ? (
          <MarkdownText key={`text-${index}`} appearance={appearance} content={part.content} />
        ) : null
      )}
    </View>
  );
}

export function UnicodeText({
  content,
  numberOfLines,
  selectable = true,
  style,
}: {
  content: string;
  numberOfLines?: number;
  selectable?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text numberOfLines={numberOfLines} selectable={selectable} style={style}>
      {content}
    </Text>
  );
}
