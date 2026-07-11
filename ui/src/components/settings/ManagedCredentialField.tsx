import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  extractApiError,
  type IntegrationCredentialId,
  type IntegrationCredentialsStatus,
  integrationCredentialsApi,
} from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";

function sourceLabel(source: "env" | "stored" | "none"): string {
  if (source === "env") return "Environment";
  if (source === "stored") return "Stored";
  return "Not configured";
}

interface ManagedCredentialFieldProps {
  credentialId: IntegrationCredentialId;
  title: string;
  description: string;
  onUpdated?: () => void;
}

export function ManagedCredentialField({
  credentialId,
  title,
  description,
  onUpdated,
}: ManagedCredentialFieldProps) {
  const [status, setStatus] = useState<IntegrationCredentialsStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useUIStore();

  const applyStatus = useCallback((next: IntegrationCredentialsStatus) => {
    setStatus(next);
    setDraft("");
  }, []);

  useEffect(() => {
    let active = true;
    void integrationCredentialsApi
      .status()
      .then((result) => {
        if (!active) return;
        if (!result.success || !result.data) {
          throw new Error(extractApiError(result, "Credential status could not be loaded"));
        }
        applyStatus(result.data);
      })
      .catch((error: unknown) => {
        if (active) {
          addToast(
            "error",
            error instanceof Error ? error.message : "Credential status could not be loaded"
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [addToast, applyStatus]);

  const credential = status?.credentials.find((item) => item.id === credentialId);
  const locked = credential?.source === "env";

  const update = async (value: string | null) => {
    setSaving(true);
    try {
      const result = await integrationCredentialsApi.update({ [credentialId]: value });
      if (!result.success || !result.data) {
        throw new Error(extractApiError(result, `${title} credential could not be updated`));
      }
      applyStatus(result.data);
      addToast(
        "success",
        value === null ? `${title} credential cleared` : `${title} credential saved`
      );
      onUpdated?.();
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : `${title} credential could not be updated`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">{title}</p>
            <p className="mt-0.5 text-xs text-gray-400">{description}</p>
          </div>
        </div>
        <Badge variant={credential?.configured ? "success" : "default"}>
          {sourceLabel(credential?.source || "none")}
        </Badge>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Input
          type="password"
          label="API key"
          value={draft}
          placeholder={credential?.configured ? "Enter a replacement key" : "Enter API key"}
          disabled={loading || saving || locked}
          helperText={locked ? `Managed by ${credential?.envVar}` : undefined}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          variant="secondary"
          className="sm:shrink-0"
          disabled={loading || saving || locked || !draft.trim()}
          isLoading={saving}
          onClick={() => void update(draft.trim())}
        >
          Save
        </Button>
        {credential?.source === "stored" ? (
          <Button
            variant="ghost"
            className="sm:shrink-0"
            disabled={saving}
            onClick={() => void update(null)}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
