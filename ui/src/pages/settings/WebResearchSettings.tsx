import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import {
  extractApiError,
  webResearchApi,
  type WebResearchCredentialId,
  type WebResearchSettingsStatus,
  type WebResearchSettingsUpdate,
  type WebResearchUrlId,
  type WebSearchBackendStatus,
  type WebSearchMcpBackend,
} from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { KeyRound, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { WebSearchBackendsPanel } from "./WebSearchBackendsPanel";

type CredentialDrafts = Partial<Record<WebResearchCredentialId, string>>;
type UrlDrafts = Partial<Record<WebResearchUrlId, string>>;

const EMPTY_MCP_BACKEND: WebSearchMcpBackend = {
  server: "",
  tool: "",
  queryArg: "",
  countArg: "",
};

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function urlHelperText(id: WebResearchUrlId): string {
  if (id === "firecrawl") return "Optional for self-hosted Firecrawl";
  if (id === "searxng") return "Optional self-hosted metasearch endpoint";
  return "Optional proxy or compatible endpoint; leave empty for the default";
}

function sourceLabel(source: "env" | "stored" | "none"): string {
  if (source === "env") return "Environment";
  if (source === "stored") return "Stored";
  return "Not configured";
}

export function WebResearchSettings() {
  const [status, setStatus] = useState<WebResearchSettingsStatus | null>(null);
  const [drafts, setDrafts] = useState<CredentialDrafts>({});
  const [urls, setUrls] = useState<UrlDrafts>({});
  const [backends, setBackends] = useState<WebSearchBackendStatus[]>([]);
  const [mcpBackend, setMcpBackend] = useState<WebSearchMcpBackend>(EMPTY_MCP_BACKEND);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useUIStore();

  const applyStatus = useCallback((next: WebResearchSettingsStatus) => {
    setStatus(next);
    setDrafts({});
    setUrls(Object.fromEntries(next.urls.map((url) => [url.id, url.value])));
    setBackends(next.backends);
    setMcpBackend({
      server: next.mcpBackend.server,
      tool: next.mcpBackend.tool,
      queryArg: next.mcpBackend.queryArg,
      countArg: next.mcpBackend.countArg,
    });
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

  const update = async (payload: WebResearchSettingsUpdate) => {
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
    const payload: WebResearchSettingsUpdate = {};
    if (Object.keys(credentials).length > 0) payload.credentials = credentials;
    const editableUrls = (status?.urls ?? []).filter((url) => url.source !== "env");
    if (editableUrls.length > 0) {
      payload.urls = Object.fromEntries(
        editableUrls.map((url) => [url.id, urls[url.id]?.trim() || null])
      );
    }
    const savedBackends = status?.backends ?? [];
    const order = backends.map((backend) => backend.id);
    if (
      status?.backendOrderSource !== "env" &&
      !sameList(
        order,
        savedBackends.map((backend) => backend.id)
      )
    ) {
      payload.backendOrder = order;
    }
    const disabledIds = backends.filter((backend) => !backend.enabled).map((backend) => backend.id);
    const savedDisabledIds = savedBackends
      .filter((backend) => !backend.enabled)
      .map((backend) => backend.id);
    if (
      status?.disabledBackendsSource !== "env" &&
      !sameList([...disabledIds].sort(), [...savedDisabledIds].sort())
    ) {
      payload.disabledBackends = disabledIds;
    }
    if (status?.mcpBackend.source !== "env") {
      payload.mcpBackend =
        mcpBackend.server.trim() || mcpBackend.tool.trim()
          ? {
              server: mcpBackend.server.trim(),
              tool: mcpBackend.tool.trim(),
              queryArg: mcpBackend.queryArg.trim(),
              countArg: mcpBackend.countArg.trim(),
            }
          : null;
    }
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
          {(status?.urls || []).map((url) => {
            const locked = url.source === "env";
            return (
              <Input
                key={url.id}
                label={url.label}
                value={urls[url.id] ?? ""}
                placeholder={url.placeholder}
                disabled={loading || saving || locked}
                helperText={locked ? `Managed by ${url.envVar}` : urlHelperText(url.id)}
                onChange={(event) =>
                  setUrls((current) => ({ ...current, [url.id]: event.target.value }))
                }
              />
            );
          })}
        </div>

        <WebSearchBackendsPanel
          status={status}
          backends={backends}
          mcpBackend={mcpBackend}
          disabled={loading || saving}
          onBackendsChange={setBackends}
          onMcpBackendChange={setMcpBackend}
        />

        <div className="flex justify-end">
          <Button disabled={loading || saving} isLoading={saving} onClick={() => void save()}>
            Save web research
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
