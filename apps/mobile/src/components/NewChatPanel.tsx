import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { GlassPanel } from "./Glass";
import { CybaraMobileApi, type AgentSummary } from "../lib/api";
import { colors, radius, spacing, typography } from "../theme/liquidGlass";

export function NewChatPanel({
  accentColor,
  agents,
  api,
  onCreated,
}: {
  accentColor: string;
  agents: AgentSummary[];
  api: CybaraMobileApi;
  onCreated: (sessionId: string) => void;
}) {
  const defaultAgentId = agents.find((agent) => agent.status === "running")?.id || agents[0]?.id;
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(defaultAgentId);
  const [agentSelectionInitialized, setAgentSelectionInitialized] = useState(
    () => defaultAgentId !== undefined
  );
  const [message, setMessage] = useState("");
  const [workspaceDir, setWorkspaceDir] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentSelectionInitialized && defaultAgentId) {
      setSelectedAgentId(defaultAgentId);
      setAgentSelectionInitialized(true);
    }
  }, [agentSelectionInitialized, defaultAgentId]);

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
          onChangeText={setMessage}
          placeholder="Ask Cybara to start working..."
          placeholderTextColor={colors.textDim}
          style={styles.composerInput}
          value={message}
        />
      </View>
      {createError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Could not create chat</Text>
          <Text style={styles.errorDetail}>{createError}</Text>
        </View>
      ) : null}
      <Pressable
        disabled={!message.trim() || creating}
        onPress={createChat}
        style={[
          styles.primaryAction,
          { backgroundColor: message.trim() ? accentColor : "rgba(255,255,255,0.08)" },
        ]}
      >
        {creating ? (
          <ActivityIndicator color={colors.text} size="small" />
        ) : (
          <Text style={styles.primaryActionText}>Create chat</Text>
        )}
      </Pressable>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: "rgba(3, 7, 11, 0.62)",
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
    backgroundColor: "rgba(85, 216, 255, 0.10)",
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
  composer: {
    alignItems: "flex-end",
    backgroundColor: "rgba(3, 7, 11, 0.9)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  messageComposer: {
    minHeight: 150,
  },
  composerInput: {
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    maxHeight: 130,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
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
  primaryAction: {
    alignItems: "center",
    borderRadius: radius.md,
    minHeight: 52,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  primaryActionText: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "900",
  },
});
