import { Check } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { BOT_ROLE_LIST, type BotRoleId, botRolePreset } from "cybara-shared/bot-roles";
import type { CybaraMobileApi } from "../lib/api";
import { createMobileBot, type MobileBotSummary } from "../lib/apiBots";
import type { AgentSummary } from "../lib/api-types";
import { haptics } from "../lib/haptics";
import { colors } from "../theme/liquidGlass";
import { GlassButton } from "../components/Glass";
import { botStyles as styles } from "./dashboardBotsStyles";

export function MobileBotCreateSheet({
  api,
  agents,
  visible,
  onClose,
  onCreated,
}: {
  api: CybaraMobileApi;
  agents: AgentSummary[];
  visible: boolean;
  onClose: () => void;
  onCreated: (bot: MobileBotSummary) => void;
}) {
  const baseAgents = useMemo(
    () => agents.filter((agent) => !agent.is_bot && agent.type !== "subagent"),
    [agents]
  );
  const [name, setName] = useState("");
  const [role, setRole] = useState<BotRoleId | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [baseAgentId, setBaseAgentId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!baseAgentId && baseAgents[0]) setBaseAgentId(baseAgents[0].id);
  }, [baseAgentId, baseAgents]);

  const chooseRole = (next: BotRoleId | "") => {
    const previous = botRolePreset(role);
    const preset = botRolePreset(next);
    setRole(next);
    if (preset && (!title.trim() || title === previous?.title)) setTitle(preset.title);
    if (preset && (!description.trim() || description === previous?.description)) {
      setDescription(preset.description);
    }
  };

  const submit = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const bot = await createMobileBot(api, {
        name: name.trim(),
        role: role || null,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        baseAgentId: baseAgentId || undefined,
      });
      haptics.success();
      setName("");
      setRole("");
      setTitle("");
      setDescription("");
      onCreated(bot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.sheetBackdrop}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>New bot</Text>
          <Text style={styles.sheetDetail}>
            Give a durable teammate a name, a role, and the agent it runs on.
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Atlas"
              placeholderTextColor={colors.textDim}
              maxLength={80}
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>Role preset</Text>
            <View style={styles.chipRail}>
              <Pressable
                onPress={() => chooseRole("")}
                style={[styles.chip, role === "" && styles.chipActive]}
              >
                <Text style={[styles.chipText, role === "" && styles.chipTextActive]}>Custom</Text>
              </Pressable>
              {BOT_ROLE_LIST.map((preset) => (
                <Pressable
                  key={preset.id}
                  onPress={() => chooseRole(preset.id)}
                  style={[styles.chip, role === preset.id && styles.chipActive]}
                >
                  <Text style={[styles.chipText, role === preset.id && styles.chipTextActive]}>
                    {preset.title}
                  </Text>
                </Pressable>
              ))}
            </View>
            {botRolePreset(role) ? (
              <Text style={styles.sheetDetail}>{botRolePreset(role)?.focus}</Text>
            ) : null}
            <Text style={styles.fieldLabel}>Job title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Release coordinator"
              placeholderTextColor={colors.textDim}
              maxLength={80}
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>Standing instructions</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Own release readiness, cite evidence, never publish without approval."
              placeholderTextColor={colors.textDim}
              maxLength={2000}
              multiline
              style={[styles.input, styles.inputMultiline]}
            />
            <Text style={styles.fieldLabel}>Runs on agent</Text>
            {baseAgents.length === 0 ? (
              <Text style={styles.sheetDetail}>
                Create an agent in Settings before adding a bot.
              </Text>
            ) : (
              baseAgents.map((agent) => {
                const selected = baseAgentId === agent.id;
                return (
                  <Pressable
                    key={agent.id}
                    onPress={() => setBaseAgentId(agent.id)}
                    style={[styles.selectRow, selected && styles.selectRowActive]}
                  >
                    <View style={styles.selectText}>
                      <Text style={styles.selectTitle} numberOfLines={1}>
                        {agent.name}
                      </Text>
                      <Text style={styles.selectDetail} numberOfLines={1}>
                        {[agent.type, agent.model].filter(Boolean).join(" · ") ||
                          "Configured agent"}
                      </Text>
                    </View>
                    <View style={[styles.check, selected && styles.checkActive]}>
                      {selected ? <Check size={13} color="#000" /> : null}
                    </View>
                  </Pressable>
                );
              })
            )}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>
          <View style={styles.sheetActions}>
            <GlassButton label="Cancel" onPress={onClose} disabled={busy} />
            <GlassButton
              label={busy ? "Creating..." : "Create bot"}
              onPress={() => void submit()}
              disabled={busy || !name.trim() || !baseAgentId}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
