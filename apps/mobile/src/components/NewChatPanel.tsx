import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CircleHelp, Send, ShieldAlert } from "lucide-react-native";
import { GlassPanel } from "./Glass";
import { CybaraMobileApi, type AgentSummary } from "../lib/api";
import {
  MOBILE_CHAT_COMPOSER,
  boundedMobileComposerHeight,
  mobileComposerHeightForDraft,
} from "../lib/dashboard";
import { colors, radius, spacing, subscribeColors, typography } from "../theme/liquidGlass";

function normalizeApprovalMode(value?: string): "always_allow" | "ask" {
  return value === "ask" ? "ask" : "always_allow";
}

function approvalLabel(mode: "always_allow" | "ask"): string {
  return mode === "ask" ? "Ask Me" : "Always Allow";
}

export function NewChatPanel({
  accentColor,
  agents,
  api,
  onConfigChanged,
  onCreated,
  toolApprovalMode,
}: {
  accentColor: string;
  agents: AgentSummary[];
  api: CybaraMobileApi;
  onConfigChanged?: () => void;
  onCreated: (sessionId: string) => void;
  toolApprovalMode?: string;
}) {
  const defaultAgentId = agents.find((agent) => agent.status === "running")?.id || agents[0]?.id;
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(defaultAgentId);
  const [agentSelectionInitialized, setAgentSelectionInitialized] = useState(
    () => defaultAgentId !== undefined
  );
  const [message, setMessage] = useState("");
  const messageRef = useRef(message);
  const [messageHeight, setMessageHeight] = useState<number>(MOBILE_CHAT_COMPOSER.minHeight);
  const [workspaceDir, setWorkspaceDir] = useState("");
  const [approvalMode, setApprovalMode] = useState<"always_allow" | "ask">(
    normalizeApprovalMode(toolApprovalMode)
  );
  const [savingApprovalMode, setSavingApprovalMode] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentSelectionInitialized && defaultAgentId) {
      setSelectedAgentId(defaultAgentId);
      setAgentSelectionInitialized(true);
    }
  }, [agentSelectionInitialized, defaultAgentId]);

  useEffect(() => {
    if (!savingApprovalMode) {
      setApprovalMode(normalizeApprovalMode(toolApprovalMode));
    }
  }, [savingApprovalMode, toolApprovalMode]);

  const createChat = async () => {
    const trimmed = message.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await api.sendChat({
        message: trimmed,
        agentId: selectedAgentId,
        workspaceDir: workspaceDir.trim() || undefined,
      });
      if (!result.sessionId) {
        throw new Error("Gateway did not return a session id.");
      }
      onCreated(result.sessionId);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const setMessageDraft = (value: string) => {
    messageRef.current = value;
    setMessage(value);
    setMessageHeight(mobileComposerHeightForDraft(value));
  };

  const saveApprovalMode = async (nextMode: "always_allow" | "ask") => {
    if (nextMode === approvalMode || savingApprovalMode) return;
    const previousMode = approvalMode;
    setApprovalMode(nextMode);
    setSavingApprovalMode(true);
    setCreateError(null);
    try {
      const result = await api.updateConfig({ tool_approval_mode: nextMode });
      if (!result.success) throw new Error("Gateway rejected the approval setting.");
      onConfigChanged?.();
    } catch (error) {
      setApprovalMode(previousMode);
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingApprovalMode(false);
    }
  };

  return (
    <GlassPanel elevated style={styles.panel}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Agent</Text>
        <Text style={styles.counterText}>{agents.length || "Default"}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalPicker}>
        <Pressable
          onPress={() => {
            setSelectedAgentId(undefined);
            setAgentSelectionInitialized(true);
          }}
          style={[
            styles.agentChip,
            !selectedAgentId && [styles.agentChipActive, { borderColor: accentColor }],
          ]}
        >
          <Text style={[styles.agentChipTitle, !selectedAgentId && { color: accentColor }]}>
            Gateway default
          </Text>
          <Text style={styles.agentChipDetail}>Auto route</Text>
        </Pressable>
        {agents.map((agent) => {
          const selected = selectedAgentId === agent.id;
          return (
            <Pressable
              key={agent.id}
              onPress={() => {
                setSelectedAgentId(agent.id);
                setAgentSelectionInitialized(true);
              }}
              style={[
                styles.agentChip,
                selected && [styles.agentChipActive, { borderColor: accentColor }],
              ]}
            >
              <Text
                numberOfLines={1}
                style={[styles.agentChipTitle, selected && { color: accentColor }]}
              >
                {agent.name}
              </Text>
              <Text numberOfLines={1} style={styles.agentChipDetail}>
                {[agent.model, agent.status].filter(Boolean).join(" - ") || "Configured"}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Permissions</Text>
        {savingApprovalMode ? (
          <ActivityIndicator color={colors.textMuted} size="small" />
        ) : (
          <Text style={styles.counterText}>{approvalLabel(approvalMode)}</Text>
        )}
      </View>
      <View style={styles.approvalRow}>
        {(["always_allow", "ask"] as const).map((mode) => {
          const selected = approvalMode === mode;
          const Icon = mode === "ask" ? CircleHelp : ShieldAlert;
          const tone = mode === "ask" ? colors.blueText : colors.amber;
          return (
            <Pressable
              accessibilityLabel={`Set tool approvals to ${approvalLabel(mode)}`}
              accessibilityRole="button"
              disabled={savingApprovalMode}
              key={mode}
              onPress={() => {
                void saveApprovalMode(mode);
              }}
              style={[
                styles.approvalChip,
                selected && [styles.agentChipActive, { borderColor: tone }],
                savingApprovalMode && { opacity: 0.72 },
              ]}
            >
              <View style={styles.approvalTitleRow}>
                <Icon color={selected ? tone : colors.textMuted} size={15} strokeWidth={2.4} />
                <Text style={[styles.approvalTitle, selected && { color: tone }]}>
                  {approvalLabel(mode)}
                </Text>
              </View>
              <Text style={styles.agentChipDetail}>
                {mode === "ask" ? "Review risky tools" : "Run trusted tools"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Workspace</Text>
      <View style={styles.composer}>
        <TextInput
          autoCapitalize="none"
          editable={!creating}
          onChangeText={setWorkspaceDir}
          placeholder="Optional workspace path"
          placeholderTextColor={colors.textDim}
          style={styles.composerInput}
          value={workspaceDir}
        />
      </View>

      <Text style={styles.sectionTitle}>First message</Text>
      <View style={[styles.composer, styles.messageComposer]}>
        <TextInput
          editable={!creating}
          multiline
          onChangeText={setMessageDraft}
          onContentSizeChange={(event) => {
            setMessageHeight(
              mobileComposerHeightForDraft(
                messageRef.current,
                boundedMobileComposerHeight(event.nativeEvent.contentSize.height)
              )
            );
          }}
          placeholder="Ask Cybara to start working..."
          placeholderTextColor={colors.textDim}
          returnKeyType="default"
          scrollEnabled={messageHeight >= MOBILE_CHAT_COMPOSER.maxHeight}
          style={[styles.composerInput, styles.messageInput, { height: messageHeight }]}
          submitBehavior="newline"
          textAlignVertical="top"
          value={message}
        />
        <Pressable
          accessibilityLabel="Create chat"
          accessibilityRole="button"
          disabled={!message.trim() || creating}
          onPress={createChat}
          style={[
            styles.sendButton,
            {
              backgroundColor: message.trim() ? accentColor : colors.inset,
              opacity: message.trim() || creating ? 1 : 0.55,
            },
          ]}
        >
          {creating ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <Send color={colors.text} size={19} strokeWidth={2.4} />
          )}
        </Pressable>
      </View>
      {createError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Could not create chat</Text>
          <Text style={styles.errorDetail}>{createError}</Text>
        </View>
      ) : null}
    </GlassPanel>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    panel: {
      gap: spacing.md,
    },
    sectionHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
    },
    sectionTitle: {
      color: colors.text,
      fontSize: typography.heading,
      fontWeight: "800",
    },
    counterText: {
      color: colors.cyan,
      fontSize: typography.body,
      fontWeight: "900",
    },
    horizontalPicker: {
      marginHorizontal: -spacing.xs,
    },
    agentChip: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      gap: 3,
      marginHorizontal: spacing.xs,
      minHeight: 72,
      padding: spacing.md,
      width: 172,
    },
    agentChipActive: {
      backgroundColor: colors.softCyan,
    },
    agentChipTitle: {
      color: colors.text,
      fontSize: typography.body,
      fontWeight: "800",
    },
    agentChipDetail: {
      color: colors.textMuted,
      fontSize: typography.tiny,
    },
    approvalRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    approvalChip: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flex: 1,
      gap: 3,
      minHeight: 58,
      padding: spacing.md,
    },
    approvalTitle: {
      color: colors.text,
      fontSize: typography.label,
      fontWeight: "900",
    },
    approvalTitleRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
    },
    composer: {
      alignItems: "flex-end",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.lg,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      padding: spacing.sm,
    },
    messageComposer: {
      minHeight: MOBILE_CHAT_COMPOSER.minHeight + spacing.sm * 2,
    },
    composerInput: {
      color: colors.text,
      flex: 1,
      fontSize: typography.body,
      includeFontPadding: false,
      minHeight: MOBILE_CHAT_COMPOSER.minHeight,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    messageInput: {
      lineHeight: MOBILE_CHAT_COMPOSER.lineHeight,
      maxHeight: MOBILE_CHAT_COMPOSER.maxHeight,
      minHeight: MOBILE_CHAT_COMPOSER.minHeight,
      paddingTop: 10,
      paddingBottom: 8,
    },
    sendButton: {
      alignItems: "center",
      borderRadius: 999,
      height: MOBILE_CHAT_COMPOSER.minHeight,
      justifyContent: "center",
      width: MOBILE_CHAT_COMPOSER.minHeight,
    },
    errorBox: {
      alignItems: "center",
      borderColor: colors.border,
      borderRadius: radius.lg,
      borderWidth: 1,
      gap: spacing.xs,
      padding: spacing.lg,
    },
    errorTitle: {
      color: colors.text,
      fontSize: typography.body,
      fontWeight: "800",
    },
    errorDetail: {
      color: colors.textMuted,
      fontSize: typography.label,
      textAlign: "center",
    },
  });

let styles = makeStyles();
subscribeColors(() => {
  styles = makeStyles();
});
