import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { extractApiError, settingsApi } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

interface SensitiveFilePolicy {
  allow_env_file_reads: boolean;
  allow_all_sensitive_reads: boolean;
}

const DEFAULT_POLICY: SensitiveFilePolicy = {
  allow_env_file_reads: false,
  allow_all_sensitive_reads: false,
};

function readPolicy(value: unknown): SensitiveFilePolicy {
  const raw = (value ?? {}) as Partial<SensitiveFilePolicy>;
  return {
    allow_env_file_reads: raw.allow_env_file_reads === true,
    allow_all_sensitive_reads: raw.allow_all_sensitive_reads === true,
  };
}

export function SensitiveFileSettings() {
  const [policy, setPolicy] = useState<SensitiveFilePolicy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useUIStore();

  useEffect(() => {
    let active = true;
    void settingsApi
      .getConfig()
      .then((result) => {
        if (!active) return;
        setPolicy(readPolicy(result.data?.sensitive_file_policy));
      })
      .catch((error: unknown) => {
        if (!active) return;
        addToast(
          "error",
          error instanceof Error ? error.message : "Sensitive file access failed to load"
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [addToast]);

  const save = async (next: SensitiveFilePolicy) => {
    setSaving(true);
    try {
      const result = await settingsApi.updateConfig({ sensitive_file_policy: next });
      if (!result.success || !result.data?.success) {
        throw new Error(extractApiError(result, "Sensitive file access update failed"));
      }
      setPolicy(next);
      addToast("success", "Sensitive file access updated");
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Sensitive file access update failed"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="w-5 h-5" />
          Sensitive file access
        </CardTitle>
        <CardDescription>
          Agents cannot read credential files such as .env, SSH keys, or cloud tokens unless you
          allow it here. Example and template files like .env.example are always readable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--surface-border)] pb-4">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Allow reading .env files
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Lets tools read .env, .env.local and similar files in your projects. Their contents
              are sent to the model provider you use.
            </p>
          </div>
          <Switch
            checked={policy.allow_env_file_reads || policy.allow_all_sensitive_reads}
            disabled={loading || saving || policy.allow_all_sensitive_reads}
            onChange={(value) => void save({ ...policy, allow_env_file_reads: value })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Allow reading all sensitive files
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Also allows SSH keys, cloud credentials, and token files. Cybara's own secure storage
              stays blocked. Writes to these files remain refused.
            </p>
          </div>
          <Switch
            checked={policy.allow_all_sensitive_reads}
            disabled={loading || saving}
            onChange={(value) => void save({ ...policy, allow_all_sensitive_reads: value })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
