import { Linking, ScrollView, Text, View, type StyleProp, type TextStyle } from "react-native";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, User } from "lucide-react-native";
import { colors } from "../theme/liquidGlass";
import { styles } from "./dashboardStyles";
import { relativeTimestamp } from "./dashboardHelpers";
import {
  buildMobileWorkTimeline,
  hasUnicodeTextFallback,
  parseMarkdownBlocks,
  shouldUseSelectableNativeText,
  splitMessageContent,
  stripStreamingReasoningForDisplay,
  type MarkdownInline,
} from "../lib/chat-format";
import type { SessionDetailSummary } from "../lib/api";

/** Render inline markdown spans (bold/italic/code/strike/link) inside a Text. */
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

/** Render a text segment as structured markdown, matching the web/Tauri UI. */
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
                <Text style={styles.mdListMarker}>{block.marker}</Text>
                <Text style={styles.mdListText}>
                  <InlineMarkdown tokens={block.inline} />
                </Text>
              </View>
            );
          case "quote":
            return (
              <View key={index} style={styles.mdQuote}>
                <Text style={styles.mdQuoteText}>
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
                        <Text style={styles.mdTableHeaderText}>
                          <InlineMarkdown tokens={cell} />
                        </Text>
                      </View>
                    ))}
                  </View>
                  {block.rows.map((row, rowIndex) => (
                    <View key={rowIndex} style={styles.mdTableRow}>
                      {row.map((cell, cellIndex) => (
                        <View key={cellIndex} style={styles.mdTableCell}>
                          <Text style={styles.mdTableCellText}>
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

export function ChatMessageRow({
  accentColor,
  message,
  nowMs,
}: {
  accentColor: string;
  message: SessionDetailSummary["messages"][number];
  nowMs?: number;
}) {
  const isUser = message.role === "user";
  if (!isUser) {
    const hasWorkTimeline = Boolean(
      message.thinking || message.processActivities?.length || message.toolCalls?.length
    );
    // Live streaming buffers can contain reasoning markup; persisted messages
    // are already sanitized by the gateway.
    const isLiveMessage =
      typeof message.id === "string" && message.id.startsWith("live-assistant-");
    const rawContent = message.content || "";
    const displayContent = isLiveMessage
      ? stripStreamingReasoningForDisplay(rawContent)
      : rawContent;
    const hasContent = displayContent.trim().length > 0;
    return (
      <View style={styles.agentMessageRow}>
        {hasWorkTimeline ? <WorkTimeline message={message} nowMs={nowMs} /> : null}
        {hasContent || !hasWorkTimeline ? (
          <MessageContent content={hasContent ? displayContent : "(empty message)"} />
        ) : null}
        {message.timestamp ? (
          <Text style={styles.messageTime}>{relativeTimestamp(message.timestamp)}</Text>
        ) : null}
      </View>
    );
  }
  return (
    <View style={[styles.chatMessageRow, styles.chatMessageRowUser]}>
      <View style={[styles.chatAvatar, { backgroundColor: `${accentColor}22` }]}>
        <User color={accentColor} size={16} strokeWidth={2.2} />
      </View>
      <View
        style={[
          styles.messageBubble,
          styles.userMessageBubble,
          { borderColor: `${accentColor}55` },
        ]}
      >
        <MessageContent content={message.content || "(empty message)"} />
        {message.timestamp ? (
          <Text style={[styles.messageTime, styles.messageTimeUser]}>
            {relativeTimestamp(message.timestamp)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function WorkActivityIcon({ phase, toolName }: { phase: string; toolName?: string }) {
  if (toolName === "__thought") {
    return <Sparkles color={colors.blueText} size={13} strokeWidth={2.2} />;
  }
  if (phase === "start") {
    return <Loader2 color={colors.amber} size={13} strokeWidth={2.2} />;
  }
  if (phase === "error") {
    return <AlertTriangle color={colors.red} size={13} strokeWidth={2.2} />;
  }
  return <CheckCircle2 color={colors.green} size={13} strokeWidth={2.2} />;
}

export function WorkTimeline({
  message,
  nowMs,
}: {
  message: SessionDetailSummary["messages"][number];
  nowMs?: number;
}) {
  const timeline = buildMobileWorkTimeline(message, nowMs);
  if (timeline.activities.length === 0) return null;

  return (
    <View style={styles.workTimeline}>
      <Text style={styles.workedForText}>Worked for {timeline.workedDuration}</Text>
      <View style={styles.messageActivityList}>
        {timeline.activities.map((activity) => (
          <View key={activity.id} style={styles.messageActivityRow}>
            <View style={styles.messageActivityIcon}>
              <WorkActivityIcon phase={activity.phase} toolName={activity.toolName} />
            </View>
            <Text
              numberOfLines={activity.toolName === "__thought" ? 3 : 2}
              style={[
                styles.messageActivityText,
                activity.toolName === "__thought" && styles.messageThoughtText,
              ]}
            >
              {activity.text}
            </Text>
          </View>
        ))}
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
            <Text style={styles.codeHeader}>{part.language}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <UnicodeText
                content={part.content}
                selectable={shouldUseSelectableNativeText(part.content)}
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
  selectable,
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
