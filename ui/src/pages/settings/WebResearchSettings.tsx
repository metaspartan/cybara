import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import {
  extractApiError,
  webResearchApi,
  type WebResearchCredentialId,
  type WebResearchSettingsStatus,
} from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { KeyRound, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type CredentialDrafts = Partial<Record<WebResearchCredentialId, string>>;

function sourceLabel(source: "env" | "stored" | "none"): string {
  if (source === "env") return "Environment";
  if (source === "stored") return "Stored";
  return "Not configured";
}

export function WebResearchSettings() {
  const [status, setStatus] = useState<WebResearchSettingsStatus | null>(null);
  const [drafts, setDrafts] = useState<CredentialDrafts>({});
  const [firecrawlApiUrl, setFirecrawlApiUrl] = useState("");
  const [searxngUrl, setSearxngUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useUIStore();

  const applyStatus = useCallback((next: WebResearchSettingsStatus) => {
    setStatus(next);
    setDrafts({});
    setFirecrawlApiUrl(next.firecrawlApiUrl.value);
    setSearxngUrl(next.searxngUrl.value);
  }, []);

  useEffect(() => {
    let active = true;
    void webResearchApi
      .settings()
      .then((result) => {
        if (!active) return;
        if (!result.success || !result.data) {
          throw new Error(extractApiError(result, "Web research settings failed to load"));
        }
        applyStatus(result.data);
      })
      .catch((error: unknown) => {
        if (active) {
          addToast(
            "error",
            error instanceof Error ? error.message : "Web research settings failed to load"
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

  const update = async (payload: Parameters<typeof webResearchApi.updateSettings>[0]) => {
    setSaving(true);
    try {
      const result = await webResearchApi.updateSettings(payload);
      if (!result.success || !result.data) {
        throw new Error(extractApiError(result, "Web research settings update failed"));
      }
      applyStatus(result.data);
      addToast("success", "Web research settings updated");
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Web research settings update failed"
      );
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const credentials = Object.fromEntries(
      Object.entries(drafts).flatMap(([id, value]) => (value?.trim() ? [[id, value.trim()]] : []))
    ) as Partial<Record<WebResearchCredentialId, string>>;
    const payload: Parameters<typeof webResearchApi.updateSettings>[0] = {};
    if (Object.keys(credentials).length > 0) payload.credentials = credentials;
    if (status?.firecrawlApiUrl.source !== "env") {
      payload.firecrawlApiUrl = firecrawlApiUrl.trim() || null;
    }
    if (status?.searxngUrl.source !== "env") payload.searxngUrl = searxngUrl.trim() || null;
    await update(payload);
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Web Research
        </CardTitle>
        <CardDescription>
          Connect search and extraction services used by agent web tools
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 xl:grid-cols-2">
          {(status?.credentials || []).map((credential) => {
            const locked = credential.source === "env";
            return (
              <div
                key={credential.id}
                className="rounded-lg border border-white/10 bg-white/[0.025] p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <KeyRound className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="truncate text-sm font-medium text-white">
                      {credential.label}
                    </span>
                  </div>
                  <Badge variant={credential.configured ? "success" : "default"}>
                    {sourceLabel(credential.source)}
                  </Badge>
                </div>
                <div className="flex items-end gap-2">
                  <Input
                    type="password"
                    label="API key"
                    value={drafts[credential.id] || ""}
                    placeholder={
                      credential.configured ? "Enter a replacement key" : "Enter API key"
                    }
                    disabled={loading || saving || locked}
                    helperText={locked ? `Managed by ${credential.envVar}` : undefined}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [credential.id]: event.target.value,
                      }))
                    }
                  />
                  {credential.source === "stored" ? (
                    <Button
                      variant="ghost"
                      disabled={saving}
                      onClick={() => void update({ credentials: { [credential.id]: null } })}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Input
            label="Firecrawl API URL"
            value={firecrawlApiUrl}
            placeholder="https://api.firecrawl.dev"
            disabled={loading || saving || status?.firecrawlApiUrl.source === "env"}
            helperText={
              status?.firecrawlApiUrl.source === "env"
                ? `Managed by ${status.firecrawlApiUrl.envVar}`
                : "Optional for self-hosted Firecrawl"
            }
            onChange={(event) => setFirecrawlApiUrl(event.target.value)}
          />
          <Input
            label="SearXNG URL"
            value={searxngUrl}
            placeholder="https://search.example.com"
            disabled={loading || saving || status?.searxngUrl.source === "env"}
            helperText={
              status?.searxngUrl.source === "env"
                ? `Managed by ${status.searxngUrl.envVar}`
                : "Optional self-hosted metasearch endpoint"
            }
            onChange={(event) => setSearxngUrl(event.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <Button disabled={loading || saving} isLoading={saving} onClick={() => void save()}>
            Save web research
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
