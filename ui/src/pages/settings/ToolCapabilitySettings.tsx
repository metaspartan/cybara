import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import {
  toolCapabilityPolicyApi,
  type ToolCapability,
  type ToolCapabilityPolicy,
  type ToolCapabilityPolicyMode,
} from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { AlertCircle, KeyRound, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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

const POLICY_OPTIONS: Array<{ value: ToolCapabilityPolicyMode; label: string }> = [
  { value: "inherit", label: "Default" },
  { value: "ask", label: "Ask every time" },
  { value: "allow", label: "Always allow" },
  { value: "deny", label: "Always deny" },
];

export function ToolCapabilitySettings() {
  const [policy, setPolicy] = useState<ToolCapabilityPolicy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ToolCapability | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { addToast } = useUIStore();

  const loadPolicy = useCallback(async (active: () => boolean = () => true): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await toolCapabilityPolicyApi.get();
      if (!active()) return;
      if (!result.success || !result.data?.policy) {
        throw new Error(result.error || "Capability policy is unavailable");
      }
      setPolicy(result.data.policy);
    } catch (error) {
      if (!active()) return;
      setLoadError(error instanceof Error ? error.message : "Capability policy is unavailable");
    } finally {
      if (active()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadPolicy(() => active);
    return () => {
      active = false;
    };
  }, [loadPolicy]);

  const overrideCount = useMemo(
    () => CAPABILITIES.filter((capability) => policy[capability.id] !== "inherit").length,
    [policy]
  );

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
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-subtle)] px-3 py-2.5">
          <p className="min-w-0 text-xs leading-relaxed text-[var(--text-muted)]">
            Default follows the current chat approval mode. A capability-specific rule takes
            precedence whenever a matching tool runs.
          </p>
          <Badge variant={overrideCount > 0 ? "warning" : "default"}>
            {overrideCount === 0 ? "Using defaults" : `${overrideCount} custom`}
          </Badge>
        </div>

        {loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <span className="flex items-center gap-2 text-sm text-red-300">
              <AlertCircle className="h-4 w-4" />
              {loadError}
            </span>
            <Button variant="outline" size="sm" onClick={() => void loadPolicy()}>
              <RotateCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : null}

        <div className="divide-y divide-[var(--surface-border)]">
          {CAPABILITIES.map((capability) => (
            <div
              key={capability.id}
              className="grid gap-3 py-3.5 sm:grid-cols-[minmax(0,1fr)_170px] sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {capability.label}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
                  {capability.detail}
                </p>
              </div>
              <Select
                aria-label={`${capability.label} policy`}
                value={policy[capability.id]}
                options={POLICY_OPTIONS}
                disabled={loading || saving !== null || loadError !== null}
                onChange={(value) =>
                  void update(capability.id, value as ToolCapabilityPolicyMode)
                }
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
