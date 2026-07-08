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
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ListChecks,
  Loader2,
  RotateCcw,
  User,
} from "lucide-react-native";
import { colors } from "../theme/liquidGlass";
import { styles } from "./dashboardStyles";
import { relativeTimestamp } from "./dashboardHelpers";
import {
  buildMobileWorkTimeline,
  groupMobileActivities,
  type MobileWorkActivity,
  hasUnicodeTextFallback,
  parseMarkdownBlocks,
  parseInlineMarkdown,
  splitMessageContent,
  type MarkdownInline,
} from "../lib/chat-format";
import type { SessionDetailSummary, SessionMessageSummary, SessionPlanSnapshot } from "../lib/api";
import { Clipboard } from "../lib/expoNativeModules";

function InlineMarkdown({ tokens }: { tokens: MarkdownInline[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.type) {
          case "bold":
            return (
              <Text key={index} style={styles.mdBold}>
                {token.text}
              </Text>
            );
          case "italic":
            return (
              <Text key={index} style={styles.mdItalic}>
                {token.text}
              </Text>
            );
          case "strike":
            return (
              <Text key={index} style={styles.mdStrike}>
                {token.text}
              </Text>
            );
          case "code":
            return (
              <Text key={index} style={styles.mdInlineCode}>
                {token.text}
              </Text>
            );
          case "link":
            return (
              <Text
                key={index}
                style={styles.mdLink}
                onPress={() => {
                  void Linking.openURL(token.href).catch(() => {});
                }}
              >
                {token.text}
              </Text>
            );
          default:
            return <Text key={index}>{token.text}</Text>;
        }
      })}
    </>
  );
}

function MarkdownText({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);
  return (
    <View style={styles.mdBlocks}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <Text
                key={index}
                selectable
                style={
                  block.level === 1 ? styles.mdH1 : block.level === 2 ? styles.mdH2 : styles.mdH3
                }
              >
                <InlineMarkdown tokens={block.inline} />
              </Text>
            );
          case "listItem":
            return (
              <View key={index} style={styles.mdListRow}>
                <Text selectable style={styles.mdListMarker}>
                  {block.marker}
                </Text>
                <Text selectable style={styles.mdListText}>
                  <InlineMarkdown tokens={block.inline} />
                </Text>
              </View>
            );
          case "quote":
            return (
              <View key={index} style={styles.mdQuote}>
                <Text selectable style={styles.mdQuoteText}>
                  <InlineMarkdown tokens={block.inline} />
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
                          <InlineMarkdown tokens={cell} />
                        </Text>
                      </View>
                    ))}
                  </View>
                  {block.rows.map((row, rowIndex) => (
                    <View key={rowIndex} style={styles.mdTableRow}>
                      {row.map((cell, cellIndex) => (
                        <View key={cellIndex} style={styles.mdTableCell}>
                          <Text selectable style={styles.mdTableCellText}>
                            <InlineMarkdown tokens={cell} />
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
              <Text key={index} selectable style={styles.mdParagraph}>
                <InlineMarkdown tokens={block.inline} />
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
  timestampLabel,
  onRevert,
}: {
  alignEnd?: boolean;
  content: string;
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
              Plan
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
  message,
  nowMs,
  onRevert,
  mediaUrl,
}: {
  accentColor: string;
  message: SessionDetailSummary["messages"][number];
  nowMs?: number;
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
      message.thinking || message.processActivities?.length || message.toolCalls?.length
    );
    const isLiveMessage =
      typeof message.id === "string" && message.id.startsWith("live-assistant-");
    if (isLiveMessage) {
      return (
        <View style={styles.agentMessageRow}>
          <WorkTimeline message={message} nowMs={nowMs} />
          <ChatImageAttachments uris={toolImageUris} />
        </View>
      );
    }
    const content = message.content || "";
    const hasContent = content.trim().length > 0;
    return (
      <View style={styles.agentMessageRow}>
        {hasWorkTimeline ? <WorkTimeline message={message} nowMs={nowMs} /> : null}
        <ChatImageAttachments uris={toolImageUris} />
        {hasContent || !hasWorkTimeline ? (
          <MessageContent content={hasContent ? content : "(empty message)"} />
        ) : null}
        <MessageActionsRow
          content={message.content || ""}
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
          <MessageContent content={message.content || "(empty message)"} />
          <ChatImageAttachments uris={userImageUris} />
        </View>
        <MessageActionsRow
          alignEnd
          content={message.content || ""}
          timestampLabel={message.timestamp ? relativeTimestamp(message.timestamp) : null}
          onRevert={onRevert ? () => onRevert(message) : undefined}
        />
      </View>
    </View>
  );
}

export function WorkActivityIcon({ phase, toolName }: { phase: string; toolName?: string }) {
  if (toolName === "__thought") {
    return <View style={styles.messageActivityDot} />;
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

function MobileActivityRow({ activity }: { activity: MobileWorkActivity }) {
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
        ]}
      >
        <InlineMarkdown tokens={parseInlineMarkdown(activity.text)} />
      </Text>
    </View>
  );
}

export function WorkTimeline({
  message,
  nowMs,
}: {
  message: SessionDetailSummary["messages"][number];
  nowMs?: number;
}) {
  const timeline = buildMobileWorkTimeline(message, nowMs);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  if (timeline.activities.length === 0) return null;

  const entries = groupMobileActivities(timeline.activities);

  return (
    <View style={styles.workTimeline}>
      <Text selectable style={styles.workedForText}>
        Worked for {timeline.workedDuration}
      </Text>
      <View style={styles.messageActivityList}>
        {entries.map((entry) => {
          if (entry.type === "single") {
            return <MobileActivityRow key={entry.activity.id} activity={entry.activity} />;
          }
          const expanded = expandedGroups[entry.id] === true;
          return (
            <View key={entry.id}>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setExpandedGroups((previous) => ({ ...previous, [entry.id]: !expanded }))
                }
                style={styles.messageActivityRow}
              >
                <View style={styles.messageActivityIcon}>
                  <CheckCircle2 color={colors.textMuted} size={13} strokeWidth={2.2} />
                </View>
                <Text style={styles.messageActivityGroupLabel}>
                  {entry.label} {expanded ? "▾" : "▸"}
                </Text>
              </Pressable>
              {expanded ? (
                <View style={styles.messageActivityGroupItems}>
                  {entry.items.map((activity) => (
                    <MobileActivityRow key={activity.id} activity={activity} />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function MessageContent({ content }: { content: string }) {
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
                ]}
              />
            </ScrollView>
          </View>
        ) : part.content.trim().length > 0 ? (
          <MarkdownText key={`text-${index}`} content={part.content} />
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
