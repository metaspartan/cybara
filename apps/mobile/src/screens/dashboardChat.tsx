import { ScrollView, Text, View, type StyleProp, type TextStyle } from "react-native";
import { AlertTriangle, Bot, CheckCircle2, Loader2, Sparkles, User } from "lucide-react-native";
import { colors } from "../theme/liquidGlass";
import { styles } from "./dashboardStyles";
import { relativeTimestamp } from "./dashboardHelpers";
import {
  buildMobileWorkTimeline,
  hasUnicodeTextFallback,
  shouldUseSelectableNativeText,
  splitMessageContent,
} from "../lib/chat-format";
import type { SessionDetailSummary } from "../lib/api";

export function ChatMessageRow({
  accentColor,
  message,
}: {
  accentColor: string;
  message: SessionDetailSummary["messages"][number];
}) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.chatMessageRow, isUser && styles.chatMessageRowUser]}>
      <View
        style={[
          styles.chatAvatar,
          { backgroundColor: isUser ? `${accentColor}22` : `${colors.green}18` },
        ]}
      >
        {isUser ? (
          <User color={accentColor} size={16} strokeWidth={2.2} />
        ) : (
          <Bot color={colors.green} size={16} strokeWidth={2.2} />
        )}
      </View>
      <View
        style={[
          styles.messageBubble,
          !isUser && styles.assistantMessageBubble,
          isUser ? [styles.userMessageBubble, { borderColor: `${accentColor}55` }] : null,
        ]}
      >
        {!isUser &&
        (message.thinking || message.processActivities?.length || message.toolCalls?.length) ? (
          <WorkTimeline message={message} />
        ) : null}
        <MessageContent content={message.content || "(empty message)"} />
        {message.timestamp ? (
          <Text style={[styles.messageTime, isUser && styles.messageTimeUser]}>
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

export function WorkTimeline({ message }: { message: SessionDetailSummary["messages"][number] }) {
  const timeline = buildMobileWorkTimeline(message);
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
        ) : (
          <UnicodeText
            key={`text-${index}`}
            content={part.content.trim().length > 0 ? part.content : "\n"}
            selectable={shouldUseSelectableNativeText(part.content)}
            style={styles.messageText}
          />
        )
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
