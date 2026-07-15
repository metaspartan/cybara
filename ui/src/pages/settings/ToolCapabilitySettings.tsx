import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import {
  toolCapabilityPolicyApi,
  type ToolCapability,
  type ToolCapabilityPolicy,
  type ToolCapabilityPolicyMode,
} from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

const CAPABILITIES: Array<{ id: ToolCapability; label: string; detail: string }> = [
  { id: "read", label: "Read", detail: "Files, memory, and local project inspection" },
  { id: "write", label: "Write", detail: "File edits and persistent memory changes" },
  { id: "execution", label: "Execution", detail: "Commands, code, processes, and Git operations" },
  { id: "network", label: "Network", detail: "Web requests, searches, and channel delivery" },
  { id: "browser", label: "Browser", detail: "Browser preview and computer control" },
  { id: "wallet", label: "Wallet", detail: "Wallet reads, signing, and transactions" },
  {
    id: "destructive",
    label: "Destructive",
    detail: "Deletion, forced Git changes, and fund movement",
  },
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

export function ToolCapabilitySettings() {
  const [policy, setPolicy] = useState<ToolCapabilityPolicy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ToolCapability | null>(null);
  const { addToast } = useUIStore();

  useEffect(() => {
    let active = true;
    void toolCapabilityPolicyApi.get().then((result) => {
      if (active && result.success && result.data?.policy) setPolicy(result.data.policy);
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const update = async (capability: ToolCapability, mode: ToolCapabilityPolicyMode) => {
    const previous = policy;
    const next = { ...policy, [capability]: mode };
    setPolicy(next);
    setSaving(capability);
    try {
      const result = await toolCapabilityPolicyApi.update(next);
      if (!result.success || !result.data?.success)
        throw new Error(result.error || "Update failed");
      setPolicy(result.data.policy);
    } catch (error) {
      setPolicy(previous);
      addToast("error", error instanceof Error ? error.message : "Failed to update policy");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" /> Capability Access
        </CardTitle>
        <CardDescription>Control what agents can do at each security boundary</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-[var(--surface-border)]">
        {CAPABILITIES.map((capability) => (
          <div key={capability.id} className="flex items-center justify-between gap-5 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)]">{capability.label}</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">{capability.detail}</p>
            </div>
            <Select
              aria-label={`${capability.label} policy`}
              className="w-32 shrink-0"
              value={policy[capability.id]}
              disabled={loading || saving !== null}
              onChange={(value) => void update(capability.id, value as ToolCapabilityPolicyMode)}
            >
              <option value="inherit">Default</option>
              <option value="ask">Ask</option>
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
