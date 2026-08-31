import { useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Bot, Save, Trash2 } from "lucide-react-native";
import type {
  ActivitySummary,
  AgentSummary,
  CybaraMobileApi,
  FeatureSummary,
  RemoteItemSummary,
} from "../lib/api";
import { colors } from "../theme/liquidGlass";
import { agentProviderId, displayFieldLabel } from "./dashboardHelpers";
import {
  DetailActionButton,
  SettingSelector,
  SettingsTextField,
  StableDetailPanel,
} from "./dashboardControls";
import { LoadingState } from "./dashboardPrimitives";
import { styles } from "./dashboardStyles";

const agentTypeOptions = ["main", "research", "coder", "planner", "ops", "worker"] as const;

function agentImageInputMode(agent: AgentSummary): string {
  const value = agent.config?.image_input;
  return value === "enabled" || value === "disabled" ? value : "auto";
}

export function AgentSettingsPanel({
  api,
  closeDetail,
  item,
  refreshSummary,
  summary,
}: {
  api: CybaraMobileApi;
  closeDetail: () => void;
  item: RemoteItemSummary | ActivitySummary;
  refreshSummary: () => void;
  summary: FeatureSummary | null;
}) {
  const summaryAgent = summary?.agents.find((agent) => agent.id === item.id);
  const itemType = "type" in item ? item.type : undefined;
  const itemStatus = "status" in item ? item.status : undefined;
  const fallbackAgent: AgentSummary = summaryAgent ?? {
    id: item.id,
    name: item.title,
    model: itemType,
    status: itemStatus,
  };
  const [agent, setAgent] = useState<AgentSummary>(fallbackAgent);
  const [loadingAgent, setLoadingAgent] = useState(true);
  const [name, setName] = useState(agent.name);
  const [type, setType] = useState(agent.type || "main");
  const [providerId, setProviderId] = useState(agentProviderId(agent));
  const [model, setModel] = useState(agent.model || "");
  const [systemPrompt, setSystemPrompt] = useState(agent.system_prompt || "");
  const [toolProfile, setToolProfile] = useState(
    typeof agent.config?.tool_profile === "string" ? agent.config.tool_profile : "full"
  );
  const [imageInput, setImageInput] = useState(agentImageInputMode(agent));
  const [maxContextTokens, setMaxContextTokens] = useState(
    typeof agent.config?.max_context_tokens === "number"
      ? String(agent.config.max_context_tokens)
      : ""
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const providerOptions = summary?.providers ?? [];

  useEffect(() => {
    let active = true;
    setAgent(fallbackAgent);
    setLoadingAgent(true);
    api
      .agent(item.id)
      .then((detail) => {
        if (active) setAgent(detail);
      })
      .catch((error) => {
        if (active) {
          Alert.alert(
            "Agent details unavailable",
            error instanceof Error ? error.message : String(error)
          );
        }
      })
      .finally(() => {
        if (active) setLoadingAgent(false);
      });
    return () => {
      active = false;
    };
  }, [api, item.id]);

  useEffect(() => {
    setName(agent.name);
    setType(agent.type || "main");
    setProviderId(agentProviderId(agent));
    setModel(agent.model || "");
    setSystemPrompt(agent.system_prompt || "");
    setToolProfile(
      typeof agent.config?.tool_profile === "string" ? agent.config.tool_profile : "full"
    );
    setImageInput(agentImageInputMode(agent));
    setMaxContextTokens(
      typeof agent.config?.max_context_tokens === "number"
        ? String(agent.config.max_context_tokens)
        : ""
    );
  }, [
    agent.id,
    agent.model,
    agent.name,
    agent.provider,
    agent.provider_id,
    agent.system_prompt,
    agent.type,
    agent.config,
  ]);

  const saveAgent = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert("Name required", "Give the agent a display name before saving.");
      return;
    }
    setSaving(true);
    try {
      const nextConfig: Record<string, unknown> = { ...(agent.config ?? {}) };
      const contextTokens = Number.parseInt(maxContextTokens.trim(), 10);
      if (Number.isFinite(contextTokens) && contextTokens > 0) {
        nextConfig.max_context_tokens = Math.max(1, Math.floor(contextTokens));
      } else {
        delete nextConfig.max_context_tokens;
      }
      if (imageInput === "enabled" || imageInput === "disabled") {
        nextConfig.image_input = imageInput;
      } else {
        delete nextConfig.image_input;
      }
      const updated = await api.updateAgent(agent.id, {
        name: trimmedName,
        type,
        provider_id: providerId || undefined,
        model: model.trim() || undefined,
        system_prompt: systemPrompt,
        config: { ...nextConfig, tool_profile: toolProfile },
      });
      setAgent(updated);
      await refreshSummary();
      Alert.alert("Agent saved", `${trimmedName} was updated.`);
    } catch (error) {
      Alert.alert("Agent save failed", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const deleteAgent = async () => {
    setDeleting(true);
    try {
      const result = await api.deleteAgent(agent.id);
      if (result.success === false) throw new Error("The gateway did not delete this agent.");
      await refreshSummary();
      closeDetail();
    } catch (error) {
      Alert.alert("Delete failed", error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert("Delete agent?", `${agent.name} will be removed from this gateway.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteAgent();
        },
      },
    ]);
  };

  return (
    <StableDetailPanel>
      <View style={styles.itemHero}>
        <View style={[styles.summaryIcon, { backgroundColor: `${colors.cyan}18` }]}>
          <Bot color={colors.cyan} size={21} strokeWidth={2.2} />
        </View>
        <View style={styles.itemHeroText}>
          <Text numberOfLines={1} style={styles.itemTitle}>
            {agent.name}
          </Text>
          <Text numberOfLines={1} style={styles.itemDetail}>
            {agent.model || "Model not set"}
          </Text>
        </View>
      </View>

      {loadingAgent ? (
        <LoadingState
          label="Loading agent settings"
          detail="Fetching the complete agent configuration."
        />
      ) : (
        <View style={styles.settingsForm}>
          <SettingsTextField
            autoCapitalize="words"
            label="Display name"
            onChangeText={setName}
            placeholder="Agent name"
            value={name}
          />
          <SettingSelector
            label="Type"
            variant="menu"
            options={agentTypeOptions.map((value) => ({ label: displayFieldLabel(value), value }))}
            selected={type}
            onSelect={setType}
          />
          <SettingSelector
            label="Provider"
            variant="menu"
            options={providerOptions.map((provider) => ({
              label: provider.name,
              value: provider.id,
            }))}
            selected={providerId}
            onSelect={setProviderId}
          />
          <SettingsTextField
            label="Model"
            onChangeText={setModel}
            placeholder="Model name"
            value={model}
          />
          <SettingSelector
            label="Tool profile"
            variant="menu"
            options={[
              { label: "Full", value: "full" },
              { label: "Coding", value: "coding" },
              { label: "Research", value: "research" },
              { label: "Read only", value: "safe" },
            ]}
            selected={toolProfile}
            onSelect={setToolProfile}
          />
          <SettingSelector
            label="Image input"
            variant="menu"
            options={[
              { label: "Auto (model metadata)", value: "auto" },
              { label: "Enabled", value: "enabled" },
              { label: "Disabled", value: "disabled" },
            ]}
            selected={imageInput}
            onSelect={setImageInput}
          />
          <SettingsTextField
            help="Leave empty to use the model default."
            keyboardType="numeric"
            label="Max context length (tokens)"
            onChangeText={setMaxContextTokens}
            placeholder="e.g. 128000"
            value={maxContextTokens}
          />
          <SettingsTextField
            help="Used as this agent's operating instructions."
            label="System prompt"
            multiline
            onChangeText={setSystemPrompt}
            placeholder="You are a helpful AI assistant..."
            value={systemPrompt}
          />
        </View>
      )}

      <View style={styles.settingsActionRow}>
        <DetailActionButton
          Icon={Save}
          busy={saving}
          disabled={loadingAgent}
          label="Save"
          onPress={saveAgent}
        />
        <DetailActionButton
          Icon={Trash2}
          busy={deleting}
          label="Delete"
          onPress={confirmDelete}
          tone={colors.red}
        />
      </View>
    </StableDetailPanel>
  );
}
