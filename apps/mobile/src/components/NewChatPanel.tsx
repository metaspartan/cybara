import { useEffect, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Brain, ChevronRight, CircleHelp, Send, ShieldAlert } from "lucide-react-native";
import { GlassPanel } from "./Glass";
import { CybaraMobileApi, type AgentSummary } from "../lib/api";
import {
  MOBILE_CHAT_COMPOSER,
  boundedMobileComposerHeight,
  createMobileSessionId,
  mobileComposerHeightForDraft,
  mobileReasoningLabel,
  mobileSupportedReasoningEfforts,
} from "../lib/dashboard";
import { haptics } from "../lib/haptics";
import { liveAssistantMessage, writeCachedMobileLiveAssistant } from "../screens/dashboardLiveChat";
import { writeCachedMobileOptimisticTranscriptMessage } from "../screens/dashboardOptimisticTranscript";
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
  onSettled,
  toolApprovalMode,
}: {
  accentColor: string;
  agents: AgentSummary[];
  api: CybaraMobileApi;
  onConfigChanged?: () => void;
  onCreated: (sessionId: string) => void;
  onSettled?: () => void;
  toolApprovalMode?: string;
}) {
  const defaultAgentId = agents.find((agent) => agent.status === "running")?.id || agents[0]?.id;
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(defaultAgentId);
  const [routerEnabled, setRouterEnabled] = useState(false);
  const [useModelRouter, setUseModelRouter] = useState(false);
  const [agentSelectionInitialized, setAgentSelectionInitialized] = useState(
    () => defaultAgentId !== undefined
  );
  const [message, setMessage] = useState("");
  const messageRef = useRef(message);
  const messageMeasuredHeightRef = useRef<number>(MOBILE_CHAT_COMPOSER.minHeight);
  const [messageHeight, setMessageHeight] = useState<number>(MOBILE_CHAT_COMPOSER.minHeight);
  const [workspaceDir, setWorkspaceDir] = useState("");
  const [approvalMode, setApprovalMode] = useState<"always_allow" | "ask">(
    normalizeApprovalMode(toolApprovalMode)
  );
  const [savingApprovalMode, setSavingApprovalMode] = useState(false);
  const [reasoningUpdating, setReasoningUpdating] = useState(false);
  const [reasoningOverride, setReasoningOverride] = useState<{
    agentId: string;
    effort: AgentSummary["reasoning_effort"];
  } | null>(null);
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

  useEffect(() => {
    let active = true;
    api
      .routerConfig()
      .then((config) => {
        if (!active) return;
        setRouterEnabled(config.enabled === true);
        if (config.enabled !== true) setUseModelRouter(false);
      })
      .catch(() => {
        if (!active) return;
        setRouterEnabled(false);
        setUseModelRouter(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const reasoningEffort =
    reasoningOverride && reasoningOverride.agentId === selectedAgent?.id
      ? reasoningOverride.effort
      : (selectedAgent?.reasoning_effort ?? null);
  const reasoningOptions = mobileSupportedReasoningEfforts(
    selectedAgent?.provider_type ?? selectedAgent?.provider_id ?? selectedAgent?.provider,
    selectedAgent?.model
  ).map((option) => ({
    label: option.label,
    value: option.value === "" ? null : option.value,
  }));
  const reasoningLabel = mobileReasoningLabel(
    reasoningEffort,
    selectedAgent?.provider_type ?? selectedAgent?.provider_id ?? selectedAgent?.provider,
    selectedAgent?.model
  );

  const saveReasoningEffort = async (effort: AgentSummary["reasoning_effort"]) => {
    if (!selectedAgent || reasoningUpdating || effort === reasoningEffort) return;
    const previous = reasoningEffort;
    setReasoningOverride({ agentId: selectedAgent.id, effort });
    setReasoningUpdating(true);
    setCreateError(null);
    try {
      const result = await api.updateAgentReasoning(selectedAgent.id, effort);
      if (!result.success) throw new Error(result.error || "Gateway rejected reasoning effort.");
      onConfigChanged?.();
    } catch (error) {
      setReasoningOverride({ agentId: selectedAgent.id, effort: previous });
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setReasoningUpdating(false);
    }
  };

  const openReasoningOptions = () => {
    if (!selectedAgent || reasoningUpdating) return;
    haptics.select();
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `${selectedAgent.name} reasoning`,
          message: "Choose how much thinking this agent uses before answering.",
          options: [...reasoningOptions.map((option) => option.label), "Cancel"],
          cancelButtonIndex: reasoningOptions.length,
        },
        (index) => {
          const option = reasoningOptions[index];
          if (option) void saveReasoningEffort(option.value);
        }
      );
      return;
    }
    Alert.alert(
      `${selectedAgent.name} reasoning`,
      "Choose how much thinking this agent uses before answering.",
      [
        ...reasoningOptions.map((option) => ({
          text: option.value === reasoningEffort ? `${option.label} ✓` : option.label,
          onPress: () => {
            void saveReasoningEffort(option.value);
          },
        })),
        { text: "Cancel", style: "cancel" as const },
      ]
    );
  };

  const createChat = () => {
    const trimmed = message.trim();
    if (!trimmed || creating || reasoningUpdating) return;
    const sessionId = createMobileSessionId();
    const startedAt = Date.now();
    writeCachedMobileOptimisticTranscriptMessage(sessionId, {
      id: `local-${startedAt}`,
      role: "user",
      content: trimmed,
      timestamp: new Date(startedAt).toISOString(),
    });
    writeCachedMobileLiveAssistant(
      sessionId,
      liveAssistantMessage(sessionId, null, startedAt),
      startedAt
    );
    setCreating(true);
    setCreateError(null);
    onCreated(sessionId);
    void api
      .sendChat({
        message: trimmed,
        sessionId,
        agentId: selectedAgentId,
        workspaceDir: workspaceDir.trim() || undefined,
        useModelRouter,
      })
      .catch((error) => {
        const failedAt = Date.now();
        const failed = liveAssistantMessage(sessionId, null, failedAt);
        writeCachedMobileLiveAssistant(sessionId, {
          ...failed,
          processActivities: [
            {
              id: `new-chat-error-${failedAt}`,
              phase: "error",
              text: error instanceof Error ? error.message : String(error),
              timestamp: failedAt,
            },
          ],
        });
      })
      .finally(() => {
        onSettled?.();
      });
  };

  const updateMessageDraft = (value: string) => {
    messageRef.current = value;
    setMessage(value);
    setMessageHeight(mobileComposerHeightForDraft(value, messageMeasuredHeightRef.current));
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
        {routerEnabled ? (
          <Pressable
            onPress={() => {
              setUseModelRouter(true);
              setSelectedAgentId(undefined);
              setAgentSelectionInitialized(true);
            }}
            style={[
              styles.agentChip,
              useModelRouter && [styles.agentChipActive, { borderColor: accentColor }],
            ]}
          >
            <Text style={[styles.agentChipTitle, useModelRouter && { color: accentColor }]}>
              Model Router
            </Text>
            <Text style={styles.agentChipDetail}>Auto route</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              setUseModelRouter(false);
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
        )}
        {agents.map((agent) => {
          const selected = !useModelRouter && selectedAgentId === agent.id;
          return (
            <Pressable
              key={agent.id}
              onPress={() => {
                setUseModelRouter(false);
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
        <Text style={styles.sectionTitle}>Reasoning</Text>
        {reasoningUpdating ? (
          <ActivityIndicator color={colors.textMuted} size="small" />
        ) : (
          <Text style={styles.counterText}>{reasoningLabel}</Text>
        )}
      </View>
      <Pressable
        accessibilityLabel={`Reasoning effort: ${reasoningLabel}`}
        accessibilityRole="button"
        disabled={!selectedAgent || reasoningUpdating}
        onPress={openReasoningOptions}
        style={({ pressed }) => [
          styles.reasoningRow,
          pressed && styles.reasoningRowPressed,
          (!selectedAgent || reasoningUpdating) && styles.reasoningRowDisabled,
        ]}
      >
        <View style={[styles.reasoningIcon, { backgroundColor: `${accentColor}18` }]}>
          <Brain color={selectedAgent ? accentColor : colors.textDim} size={18} />
        </View>
        <View style={styles.reasoningText}>
          <Text style={styles.reasoningTitle}>Reasoning effort</Text>
          <Text numberOfLines={1} style={styles.agentChipDetail}>
            {selectedAgent
              ? `Applied to ${selectedAgent.name}`
              : useModelRouter
                ? "Chosen automatically by the router"
                : "Select an agent to customize"}
          </Text>
        </View>
        <ChevronRight color={colors.textMuted} size={18} />
      </Pressable>

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
          onChangeText={updateMessageDraft}
          onContentSizeChange={(event) => {
            messageMeasuredHeightRef.current = boundedMobileComposerHeight(
              event.nativeEvent.contentSize.height
            );
            setMessageHeight(
              mobileComposerHeightForDraft(messageRef.current, messageMeasuredHeightRef.current)
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
          disabled={!message.trim() || creating || reasoningUpdating}
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
    reasoningRow: {
      alignItems: "center",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.lg,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      minHeight: 58,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    reasoningRowPressed: {
      opacity: 0.78,
    },
    reasoningRowDisabled: {
      opacity: 0.58,
    },
    reasoningIcon: {
      alignItems: "center",
      borderRadius: radius.md,
      height: 36,
      justifyContent: "center",
      width: 36,
    },
    reasoningText: {
      flex: 1,
      gap: 2,
    },
    reasoningTitle: {
      color: colors.text,
      fontSize: typography.body,
      fontWeight: "800",
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
