import {
  Boxes,
  ExternalLink,
  FolderInput,
  Package,
  Play,
  Plug,
  Search,
  Server,
  Square,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageLayout } from "@/components/layout";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import {
  type InstalledPluginSummary,
  type MCPServer,
  type PluginCatalogSummary,
  type PluginInstallPayload,
  mcpApi,
  pluginsApi,
} from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";
import { openExternal } from "@/utils/openExternal";
import { AccountAppsPanel } from "./plugins/AccountAppsPanel";
import { PluginInstallDialog } from "./plugins/PluginInstallDialog";

type PluginTab = "installed" | "discover" | "apps" | "services";

const tabs: Array<{
  id: PluginTab;
  label: string;
  icon: typeof Package;
}> = [
  { id: "installed", label: "Installed", icon: Package },
  { id: "discover", label: "Discover", icon: Search },
  { id: "apps", label: "Account apps", icon: Plug },
  { id: "services", label: "MCP services", icon: Server },
];

function sourceLabel(source: InstalledPluginSummary["source"]): string {
  if (source === "workspace") return "Workspace";
  if (source === "bundled") return "Built in";
  return "Local";
}

function serviceStatusVariant(status: string): "success" | "warning" | "error" | "default" {
  if (status === "running") return "success";
  if (status === "starting") return "warning";
  if (status === "error") return "error";
  return "default";
}

export function Plugins() {
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const [tab, setTab] = useState<PluginTab>("installed");
  const [plugins, setPlugins] = useState<InstalledPluginSummary[]>([]);
  const [catalog, setCatalog] = useState<PluginCatalogSummary[]>([]);
  const [pluginSearch, setPluginSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<"all" | "installed">("all");
  const [services, setServices] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  const loadPlugins = useCallback(async (): Promise<void> => {
    const [pluginResponse, catalogResponse] = await Promise.all([
      pluginsApi.list(),
      pluginsApi.catalog(),
    ]);
    if (!pluginResponse.success || !pluginResponse.data) {
      throw new Error(pluginResponse.error || "Failed to load installed plugins");
    }
    if (!catalogResponse.success || !catalogResponse.data) {
      throw new Error(catalogResponse.error || "Failed to load plugin catalog");
    }
    setPlugins(pluginResponse.data.plugins);
    setCatalog(catalogResponse.data.plugins);
  }, []);

  const loadServices = useCallback(async (): Promise<void> => {
    const serviceResponse = await mcpApi.list();
    if (!serviceResponse.success || !Array.isArray(serviceResponse.data)) {
      throw new Error(serviceResponse.error || "Failed to load MCP services");
    }
    setServices(serviceResponse.data);
  }, []);

  useEffect(() => {
    void Promise.allSettled([loadPlugins(), loadServices()])
      .then((results) => {
        const failures = results.flatMap((result) =>
          result.status === "rejected"
            ? [
                result.reason instanceof Error
                  ? result.reason.message
                  : "Plugin capability unavailable",
              ]
            : []
        );
        if (failures.length > 0) addToast("error", failures.join(". "));
      })
      .finally(() => setLoading(false));
  }, [addToast, loadPlugins, loadServices]);

  const install = async (payload: PluginInstallPayload): Promise<void> => {
    setBusyId("install");
    try {
      const response = await pluginsApi.install(payload);
      if (!response.success) throw new Error(response.error || "Plugin installation failed");
      await loadPlugins();
      setShowInstall(false);
      addToast("success", "Plugin installed");
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Plugin installation failed");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (plugin: InstalledPluginSummary): Promise<void> => {
    if (!window.confirm(`Remove ${plugin.name}?`)) return;
    setBusyId(plugin.id);
    try {
      const response = await pluginsApi.remove(plugin.id);
      if (!response.success || response.data?.success !== true) {
        throw new Error(response.error || "Plugin removal failed");
      }
      await loadPlugins();
      addToast("success", `${plugin.name} removed`);
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Plugin removal failed");
    } finally {
      setBusyId(null);
    }
  };

  const setEnabled = async (plugin: InstalledPluginSummary, enabled: boolean): Promise<void> => {
    setBusyId(plugin.id);
    setPlugins((current) =>
      current.map((entry) => (entry.id === plugin.id ? { ...entry, enabled } : entry))
    );
    setCatalog((current) =>
      current.map((entry) => (entry.id === plugin.id ? { ...entry, enabled } : entry))
    );
    try {
      const response = await pluginsApi.setEnabled(plugin.id, enabled);
      if (!response.success || response.data?.success !== true) {
        throw new Error(response.error || "Plugin update failed");
      }
      await loadPlugins();
      addToast("success", `${plugin.name} ${enabled ? "enabled" : "disabled"}`);
    } catch (error) {
      await loadPlugins().catch(() => undefined);
      addToast("error", error instanceof Error ? error.message : "Plugin update failed");
    } finally {
      setBusyId(null);
    }
  };

  const normalizedSearch = pluginSearch.trim().toLowerCase();
  const visibleCatalog = catalog.filter((plugin) => {
    if (catalogFilter === "installed" && !plugin.installed) return false;
    if (!normalizedSearch) return true;
    return [plugin.name, plugin.description, ...plugin.tags, ...plugin.skillNames]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch);
  });

  const setServiceRunning = async (service: MCPServer, running: boolean): Promise<void> => {
    setBusyId(service.id);
    try {
      const response = running ? await mcpApi.start(service.id) : await mcpApi.stop(service.id);
      if (!response.success || response.data?.success !== true) {
        throw new Error(response.error || response.data?.error || "MCP service update failed");
      }
      await loadServices();
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "MCP service update failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageLayout
      title="Plugins"
      subtitle="Manage reusable skills, account apps, and MCP services"
      actions={
        tab === "installed" ? (
          <Button
            size="sm"
            leftIcon={<FolderInput className="h-4 w-4" />}
            onClick={() => setShowInstall(true)}
          >
            Install plugin
          </Button>
        ) : null
      }
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <div
          className="grid grid-cols-2 rounded-lg bg-[var(--surface-panel)] p-1 sm:grid-cols-4"
          role="tablist"
          aria-label="Plugin capabilities"
        >
          {tabs.map((item) => {
            const Icon = item.icon;
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setTab(item.id)}
                className={`flex min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  selected
                    ? "bg-[rgba(var(--accent-primary),0.12)] text-[rgb(var(--accent-primary))]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        {tab === "installed" ? (
          loading ? (
            <div className="grid gap-3 md:grid-cols-2" aria-label="Loading installed plugins">
              {[0, 1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-40 animate-pulse rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)]"
                />
              ))}
            </div>
          ) : plugins.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-lg bg-[var(--surface-panel)] px-6 text-center">
              <Boxes className="mb-3 h-8 w-8 text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                No installed plugins
              </h2>
              <p className="mt-1 max-w-md text-sm text-[var(--text-muted)]">
                Browse Discover or install a trusted folder or ZIP to add reusable skills.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {plugins.map((plugin) => (
                <section
                  key={plugin.id}
                  className="flex min-h-40 flex-col rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[rgba(var(--accent-primary),0.12)] text-[rgb(var(--accent-primary))]">
                      <Package className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                          {plugin.name}
                        </h2>
                        <Badge>{sourceLabel(plugin.source)}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        v{plugin.version} · {plugin.skillCount} skill
                        {plugin.skillCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-[var(--text-secondary)]">
                    {plugin.description}
                  </p>
                  <div className="mt-auto flex items-center gap-2 pt-4">
                    <Switch
                      checked={plugin.enabled}
                      disabled={busyId === plugin.id}
                      ariaLabel={`${plugin.enabled ? "Disable" : "Enable"} ${plugin.name}`}
                      onChange={(enabled) => void setEnabled(plugin, enabled)}
                    />
                    {plugin.homepage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<ExternalLink className="h-4 w-4" />}
                        onClick={() => void openExternal(plugin.homepage as string)}
                      >
                        Details
                      </Button>
                    ) : null}
                    {plugin.source === "local" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        isLoading={busyId === plugin.id}
                        leftIcon={<Trash2 className="h-4 w-4" />}
                        onClick={() => void remove(plugin)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </section>
              ))}
            </div>
          )
        ) : null}

        {tab === "discover" ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="search"
                  value={pluginSearch}
                  onChange={(event) => setPluginSearch(event.target.value)}
                  placeholder="Search plugins..."
                  className="h-10 w-full rounded-md border border-[var(--surface-border)] bg-[var(--surface-panel)] pl-9 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[rgb(var(--accent-primary))]"
                />
              </label>
              <div
                className="flex rounded-md bg-[var(--surface-panel)] p-1"
                aria-label="Plugin filter"
              >
                {(["all", "installed"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setCatalogFilter(filter)}
                    className={`rounded px-3 py-1.5 text-sm capitalize ${
                      catalogFilter === filter
                        ? "bg-[rgba(var(--accent-primary),0.12)] text-[rgb(var(--accent-primary))]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              {visibleCatalog.length} {visibleCatalog.length === 1 ? "item" : "items"}
            </p>
            {visibleCatalog.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center bg-[var(--surface-panel)] px-6 text-center">
                <Search className="mb-3 h-7 w-7 text-[var(--text-muted)]" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">No plugins found</p>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  Try another name or category.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--surface-border)] overflow-hidden rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)]">
                {visibleCatalog.map((plugin) => {
                  const installed = plugins.find((entry) => entry.id === plugin.id);
                  return (
                    <section key={plugin.id} className="flex items-start gap-3 px-4 py-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[rgba(var(--accent-primary),0.12)] text-[rgb(var(--accent-primary))]">
                        <Package className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                            {plugin.name}
                          </h2>
                          <Badge>{plugin.installed ? "Installed" : "Available"}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-[var(--text-secondary)]">
                          {plugin.description}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {plugin.tags.map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                          ))}
                        </div>
                      </div>
                      {installed ? (
                        <Switch
                          checked={installed.enabled}
                          disabled={busyId === installed.id}
                          ariaLabel={`${installed.enabled ? "Disable" : "Enable"} ${installed.name}`}
                          onChange={(enabled) => void setEnabled(installed, enabled)}
                        />
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {tab === "apps" ? <AccountAppsPanel /> : null}

        {tab === "services" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)]">MCP services</p>
                <p className="text-sm text-[var(--text-muted)]">
                  Add remote endpoints or trusted local services from the registry.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate("/mcp")}>
                Manage
              </Button>
            </div>
            {services.length === 0 ? (
              <div className="flex min-h-44 flex-col items-center justify-center rounded-lg bg-[var(--surface-panel)] px-6 text-center">
                <Server className="mb-3 h-8 w-8 text-[var(--text-muted)]" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">No MCP services</p>
                <Button className="mt-3" size="sm" onClick={() => navigate("/mcp")}>
                  Browse services
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-[var(--surface-border)] overflow-hidden rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)]">
                {services.map((service) => (
                  <div key={service.id} className="flex items-center gap-3 px-4 py-3">
                    <Server className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {service.name}
                      </p>
                      <p className="truncate text-xs text-[var(--text-muted)]">
                        {service.transport === "http" ? "Remote" : "Local"} · {service.toolCount}{" "}
                        tool
                        {service.toolCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Badge variant={serviceStatusVariant(service.status)}>{service.status}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={busyId === service.id}
                      leftIcon={
                        service.status === "running" ? (
                          <Square className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )
                      }
                      onClick={() => void setServiceRunning(service, service.status !== "running")}
                    >
                      {service.status === "running" ? "Stop" : "Start"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <PluginInstallDialog
        isOpen={showInstall}
        installing={busyId === "install"}
        onClose={() => setShowInstall(false)}
        onInstall={install}
      />
    </PageLayout>
  );
}
