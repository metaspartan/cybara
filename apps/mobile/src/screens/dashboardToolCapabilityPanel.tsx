import { useEffect, useState } from "react";
import { Alert } from "react-native";
import type {
  CybaraMobileApi,
  ToolCapability,
  ToolCapabilityPolicy,
  ToolCapabilityPolicyMode,
} from "../lib/api";
import { SettingsSection, SettingSelector } from "./dashboardControls";

const CAPABILITIES: Array<{ id: ToolCapability; label: string }> = [
  { id: "read", label: "Read" },
  { id: "write", label: "Write" },
  { id: "execution", label: "Execution" },
  { id: "network", label: "Network" },
  { id: "browser", label: "Browser and computer use" },
  { id: "wallet", label: "Wallet" },
  { id: "destructive", label: "Destructive actions" },
];

const DEFAULT_POLICY: ToolCapabilityPolicy = {
  read: "inherit",
  write: "inherit",
  execution: "inherit",
  network: "inherit",
  browser: "inherit",
  wallet: "inherit",
  destructive: "inherit",
};

export function MobileToolCapabilityPanel({
  accentColor,
  api,
}: {
  accentColor: string;
  api: CybaraMobileApi;
}) {
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [saving, setSaving] = useState<ToolCapability | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .toolCapabilityPolicy()
      .then((response) => {
        if (active) setPolicy(response.policy);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);

  const update = async (capability: ToolCapability, mode: ToolCapabilityPolicyMode) => {
    const previous = policy;
    const next = { ...policy, [capability]: mode };
    setPolicy(next);
    setSaving(capability);
    try {
      const response = await api.updateToolCapabilityPolicy(next);
      setPolicy(response.policy);
    } catch (error) {
      setPolicy(previous);
      Alert.alert(
        "Capability update failed",
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setSaving(null);
    }
  };

  return (
    <SettingsSection title="Capability access">
      {CAPABILITIES.map((capability) => (
        <SettingSelector
          disabled={saving !== null}
          key={capability.id}
          label={capability.label}
          onSelect={(value) => void update(capability.id, value as ToolCapabilityPolicyMode)}
          options={[
            { label: "Default", value: "inherit" },
            { label: "Ask", value: "ask" },
            { label: "Allow", value: "allow" },
            { label: "Deny", value: "deny" },
          ]}
          selected={policy[capability.id]}
          tone={accentColor}
          variant="menu"
        />
      ))}
    </SettingsSection>
  );
}
