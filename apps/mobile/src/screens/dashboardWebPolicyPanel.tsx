import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { Save } from "lucide-react-native";
import type { CybaraMobileApi } from "../lib/api";
import {
  DetailActionButton,
  SettingToggle,
  SettingsSection,
  SettingsTextField,
} from "./dashboardControls";

interface WebToolPolicy {
  enabled: boolean;
  fetch_allowlist: string[];
  search_result_allowlist: string[];
}

function textList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function MobileWebPolicyPanel({
  accentColor,
  api,
  config,
  refreshSummary,
}: {
  accentColor: string;
  api: CybaraMobileApi;
  config: Record<string, unknown>;
  refreshSummary: () => Promise<void> | void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [fetchHosts, setFetchHosts] = useState("");
  const [searchHosts, setSearchHosts] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const raw = (config.web_tool_url_policy ?? {}) as Partial<WebToolPolicy>;
    setEnabled(raw.enabled === true);
    setFetchHosts(Array.isArray(raw.fetch_allowlist) ? raw.fetch_allowlist.join("\n") : "");
    setSearchHosts(
      Array.isArray(raw.search_result_allowlist) ? raw.search_result_allowlist.join("\n") : ""
    );
  }, [config]);

  const save = async (nextEnabled = enabled) => {
    if (saving) return;
    const policy: WebToolPolicy = {
      enabled: nextEnabled,
      fetch_allowlist: textList(fetchHosts),
      search_result_allowlist: textList(searchHosts),
    };
    setSaving(true);
    try {
      const result = await api.updateConfig({ web_tool_url_policy: policy });
      if (result.success === false) throw new Error("The gateway rejected the web access policy.");
      setEnabled(nextEnabled);
      await refreshSummary();
    } catch (error) {
      Alert.alert(
        "Web access policy failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection title="Web access policy">
      <SettingToggle
        busy={saving}
        detail="Restrict direct fetches and search results to trusted hosts. Empty enabled lists block access."
        label="Enforce host allowlists"
        onPress={() => void save(!enabled)}
        tone={accentColor}
        value={enabled}
      />
      <SettingsTextField
        editable={!saving}
        help="One hostname per line."
        label="Direct fetch hosts"
        multiline
        onChangeText={setFetchHosts}
        placeholder="api.example.com"
        value={fetchHosts}
      />
      <SettingsTextField
        editable={!saving}
        help="Only results from these hostnames are returned."
        label="Search result hosts"
        multiline
        onChangeText={setSearchHosts}
        placeholder="docs.example.com"
        value={searchHosts}
      />
      <DetailActionButton
        Icon={Save}
        busy={saving}
        label="Save policy"
        onPress={() => void save()}
      />
    </SettingsSection>
  );
}
