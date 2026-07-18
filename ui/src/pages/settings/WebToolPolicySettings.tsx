import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { extractApiError, settingsApi } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { Globe2 } from "lucide-react";
import { useEffect, useState } from "react";

interface WebToolPolicy {
  enabled: boolean;
  fetch_allowlist: string[];
  search_result_allowlist: string[];
}

function listText(value: unknown): string {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").join("\n")
    : "";
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

export function WebToolPolicySettings() {
  const [enabled, setEnabled] = useState(false);
  const [fetchHosts, setFetchHosts] = useState("");
  const [searchHosts, setSearchHosts] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { addToast } = useUIStore();

  useEffect(() => {
    let active = true;
    void settingsApi
      .getConfig()
      .then((result) => {
        if (!active) return;
        const raw = result.data?.web_tool_url_policy as Partial<WebToolPolicy> | undefined;
        setEnabled(raw?.enabled === true);
        setFetchHosts(listText(raw?.fetch_allowlist));
        setSearchHosts(listText(raw?.search_result_allowlist));
      })
      .catch((error: unknown) => {
        if (!active) return;
        addToast(
          "error",
          error instanceof Error ? error.message : "Web access policy failed to load"
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [addToast]);

  const save = async (nextEnabled = enabled) => {
    const policy: WebToolPolicy = {
      enabled: nextEnabled,
      fetch_allowlist: textList(fetchHosts),
      search_result_allowlist: textList(searchHosts),
    };
    setSaving(true);
    try {
      const result = await settingsApi.updateConfig({ web_tool_url_policy: policy });
      if (!result.success || !result.data?.success) {
        throw new Error(extractApiError(result, "Web access policy update failed"));
      }
      setEnabled(nextEnabled);
      setFetchHosts(policy.fetch_allowlist.join("\n"));
      setSearchHosts(policy.search_result_allowlist.join("\n"));
      addToast("success", nextEnabled ? "Web access policy enabled" : "Web access policy disabled");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Web access policy update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="liquid">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe2 className="w-5 h-5" />
          Web Access Policy
        </CardTitle>
        <CardDescription>
          Restrict direct fetches and search results to trusted hosts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--surface-border)] pb-4">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Enforce host allowlists
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              When enabled, an empty list blocks that category instead of allowing every host.
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={loading || saving}
            onChange={(value) => void save(value)}
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Textarea
            label="Direct fetch hosts"
            helperText="One hostname per line, such as api.example.com."
            value={fetchHosts}
            disabled={loading || saving}
            onChange={(event) => setFetchHosts(event.target.value)}
          />
          <Textarea
            label="Search result hosts"
            helperText="Only results from these hostnames are returned to agents."
            value={searchHosts}
            disabled={loading || saving}
            onChange={(event) => setSearchHosts(event.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button disabled={loading || saving} isLoading={saving} onClick={() => void save()}>
            Save policy
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
