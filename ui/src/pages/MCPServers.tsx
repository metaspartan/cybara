import {
  CheckCircle,
  Download,
  Globe2,
  KeyRound,
  Package,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Square,
  TerminalSquare,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PageLayout } from "@/components/layout";
import { ManagedCredentialField } from "@/components/settings/ManagedCredentialField";
import { type MCPRegistryServer, type MCPServer, mcpApi } from "@/lib/api";
import { openExternal } from "@/utils/openExternal";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { useUIStore } from "../stores/uiStore";

function needsOAuth(error: string | undefined): boolean {
  return /\b401\b|unauthori[sz]ed|authentication required/i.test(error || "");
}

async function waitForOAuth(state: string): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
    const result = await mcpApi.oauthStatus(state);
    const status = result.data;
    if (result.success && status?.status === "connected") return;
    if (status?.status === "error") throw new Error(status.error || "Authorization failed");
    if (status?.status === "not_found") throw new Error("Authorization request expired");
  }
  throw new Error("Authorization timed out");
}

export function MCPServers() {
  const [tab, setTab] = useState<"installed" | "registry">("installed");
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [registryServers, setRegistryServers] = useState<MCPRegistryServer[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const registryRequest = useRef(0);
  const { addToast } = useUIStore();

  const loadServers = async () => {
    setLoading(true);
    try {
      const result = await mcpApi.list();
      if (!result.success || !Array.isArray(result.data)) {
        throw new Error(result.error || "Failed to load MCP servers");
      }
      setServers(result.data);
    } catch {
      addToast("error", "Failed to load MCP servers");
    } finally {
      setLoading(false);
    }
  };

  const loadRegistry = async (query = searchQuery) => {
    const request = ++registryRequest.current;
    setLoading(true);
    try {
      if (query.trim()) {
        const result = await mcpApi.search(query.trim());
        if (!result.success || !Array.isArray(result.data)) {
          throw new Error(result.error || "Failed to load registry");
        }
        if (request === registryRequest.current) setRegistryServers(result.data);
      } else {
        const result = await mcpApi.popular();
        if (!result.success || !Array.isArray(result.data)) {
          throw new Error(result.error || "Failed to load registry");
        }
        if (request === registryRequest.current) setRegistryServers(result.data);
      }
    } catch {
      if (request === registryRequest.current) addToast("error", "Failed to load registry");
    } finally {
      if (request === registryRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "installed") {
      loadServers();
    } else {
      loadRegistry();
    }
    if (tab !== "installed") return;
    const timer = window.setInterval(() => {
      if (!document.hidden) loadServers();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [tab]);

  useEffect(() => {
    if (tab === "registry") {
      const timeout = setTimeout(() => loadRegistry(searchQuery), 300);
      return () => clearTimeout(timeout);
    }
  }, [searchQuery]);

  const authorizeServer = async (id: string) => {
    const result = await mcpApi.startOAuth(id);
    if (!result.success || !result.data?.authUrl || !result.data.state) {
      throw new Error(result.error || result.data?.error || "Authorization is unavailable");
    }
    await openExternal(result.data.authUrl);
    addToast("info", "Complete authorization in your browser");
    await waitForOAuth(result.data.state);
    addToast("success", "Remote MCP server connected");
    await loadServers();
  };

  const handleStart = async (id: string) => {
    const result = await mcpApi.start(id);
    if (result.success && result.data?.success) {
      addToast("success", "Server started");
      loadServers();
    } else {
      const error = result.error || result.data?.error;
      if (needsOAuth(error)) {
        try {
          await authorizeServer(id);
        } catch (authorizationError) {
          addToast(
            "error",
            authorizationError instanceof Error
              ? authorizationError.message
              : "Authorization failed"
          );
        }
      } else {
        addToast("error", error || "Failed to start");
      }
    }
  };

  const handleStop = async (id: string) => {
    const result = await mcpApi.stop(id);
    if (result.success && result.data?.success) {
      addToast("info", "Server stopped");
      loadServers();
    } else {
      addToast("error", result.error || result.data?.error || "Failed to stop");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this MCP server?")) return;
    const result = await mcpApi.delete(id);
    if (result.success && result.data?.success) {
      addToast("success", "Server deleted");
      loadServers();
    } else {
      addToast("error", result.error || "Failed to delete server");
    }
  };

  const handleInstall = async (server: MCPRegistryServer) => {
    if (!confirm(`Install ${server.name}? MCP servers run third-party code on this machine.`)) {
      return;
    }
    addToast("info", `Installing ${server.name}...`);
    const result = await mcpApi.install({ id: server.id, trustedAction: true });
    if (result.success && result.data?.success) {
      addToast("success", `${server.name} installed!`);
      setTab("installed");
      loadServers();
    } else {
      addToast("error", result.error || result.data?.error || "Install failed");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return (
          <Badge variant="success" size="sm">
            <CheckCircle className="w-3 h-3 mr-1" />
            Running
          </Badge>
        );
      case "starting":
        return (
          <Badge variant="warning" size="sm">
            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
            Starting
          </Badge>
        );
      case "error":
        return (
          <Badge variant="error" size="sm">
            <XCircle className="w-3 h-3 mr-1" />
            Error
          </Badge>
        );
      default:
        return (
          <Badge variant="default" size="sm">
            Stopped
          </Badge>
        );
    }
  };

  const getRegistryBadge = (registry: string) => {
    const colors: Record<string, string> = {
      official: "from-indigo-500 to-violet-500",
      smithery: "from-emerald-500 to-teal-500",
      "mcp.so": "from-amber-500 to-orange-500",
      npm: "from-red-500 to-pink-500",
    };
    return (
      <span
        className={`px-2 py-0.5 text-xs rounded-full bg-gradient-to-r ${colors[registry] || "from-gray-500 to-gray-600"} text-white`}
      >
        {registry}
      </span>
    );
  };

  return (
    <PageLayout
      title="MCP Servers"
      subtitle="Model Context Protocol servers for external tools"
      actions={
        <Button leftIcon={<Plus className="w-4 h-4" />} onClick={() => setShowAddModal(true)}>
          Add Server
        </Button>
      }
    >
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab("installed")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === "installed"
              ? "bg-gradient-to-r from-indigo-500/20 to-violet-500/20 text-white border border-indigo-500/30"
              : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Server className="w-4 h-4 inline mr-2" />
          Installed ({servers.length})
        </button>
        <button
          onClick={() => setTab("registry")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === "registry"
              ? "bg-gradient-to-r from-indigo-500/20 to-violet-500/20 text-white border border-indigo-500/30"
              : "text-gray-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Package className="w-4 h-4 inline mr-2" />
          Browse Registry
        </button>
      </div>

      {tab === "registry" && (
        <div className="mb-6 max-w-2xl space-y-4">
          <ManagedCredentialField
            credentialId="smithery"
            title="Smithery registry"
            description="Enable authenticated search across the Smithery catalog."
            onUpdated={() => void loadRegistry()}
          />
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <Input
              placeholder="Search MCP servers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      ) : tab === "installed" ? (
        servers.length === 0 ? (
          <Card className="p-10 text-center">
            <Server className="w-12 h-12 mx-auto text-gray-500 mb-3" />
            <p className="text-gray-300 font-medium mb-1">No MCP servers installed</p>
            <p className="text-gray-500 text-sm">Add one manually or install from the registry.</p>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {servers.map((server) => (
              <Card key={server.id} className="p-4 hover:border-indigo-500/30 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center">
                      {server.transport === "http" || server.url ? (
                        <Globe2 className="w-5 h-5 text-indigo-400" />
                      ) : (
                        <Server className="w-5 h-5 text-indigo-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-medium text-white truncate">{server.name}</h3>
                      <p className="text-xs text-gray-500 truncate">
                        {server.url || server.command}
                      </p>
                    </div>
                  </div>
                  {getStatusBadge(server.status)}
                </div>

                <div className="text-xs text-gray-500 mb-4 flex items-center gap-2">
                  <span>{server.toolCount} tools available</span>
                  <span>·</span>
                  <span>
                    {server.transport === "http" || server.url ? "Remote HTTPS" : "Local process"}
                  </span>
                </div>

                <div className="flex gap-2">
                  {server.status === "running" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1"
                      leftIcon={<Square className="w-4 h-4" />}
                      onClick={() => handleStop(server.id)}
                    >
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="flex-1"
                      leftIcon={<Play className="w-4 h-4" />}
                      onClick={() => handleStart(server.id)}
                    >
                      Start
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<Trash2 className="w-4 h-4" />}
                    onClick={() => handleDelete(server.id)}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : registryServers.length === 0 ? (
        <Card className="p-10 text-center">
          <Package className="w-12 h-12 mx-auto text-gray-500 mb-3" />
          <p className="text-gray-300 font-medium mb-1">No registry servers found</p>
          <p className="text-gray-500 text-sm">Try a different search query.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {registryServers.map((server) => (
            <Card key={server.id} className="p-4 hover:border-indigo-500/30 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center">
                    <Package className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-white">{server.name}</h3>
                    {getRegistryBadge(server.registry)}
                  </div>
                </div>
              </div>
              <p className="text-sm text-gray-400 mb-3 line-clamp-2">{server.description}</p>
              {server.url ? (
                <p className="text-xs text-gray-500 mb-3 truncate">{server.url}</p>
              ) : null}
              {server.envVars && server.envVars.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {server.envVars.map((v) => (
                    <span
                      key={v}
                      className="px-2 py-0.5 text-xs rounded bg-amber-500/20 text-amber-400"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  leftIcon={<Download className="w-4 h-4" />}
                  onClick={() => handleInstall(server)}
                >
                  Install
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AddServerModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAuthorize={authorizeServer}
        onSuccess={() => {
          setShowAddModal(false);
          loadServers();
        }}
      />
    </PageLayout>
  );
}

function AddServerModal({
  isOpen,
  onClose,
  onAuthorize,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAuthorize: (id: string) => Promise<void>;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"remote" | "local">("remote");
  const [url, setUrl] = useState("");
  const [authorization, setAuthorization] = useState("");
  const [command, setCommand] = useState("bunx");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [loading, setLoading] = useState(false);
  const { addToast } = useUIStore();

  const handleSubmit = async () => {
    if (!name.trim() || (mode === "remote" ? !url.trim() : !command.trim())) {
      addToast(
        "error",
        mode === "remote" ? "Name and HTTPS URL are required" : "Name and command are required"
      );
      return;
    }

    setLoading(true);
    try {
      const result = await mcpApi.create({
        name: name.trim(),
        command: mode === "local" ? command.trim() : undefined,
        args: mode === "local" ? args || undefined : undefined,
        env: mode === "local" ? env || undefined : undefined,
        url: mode === "remote" ? url.trim() : undefined,
        authorization: mode === "remote" ? authorization.trim() || undefined : undefined,
        enabled: true,
      });
      if (result.success && result.data?.id) {
        if (mode === "remote") {
          const started = await mcpApi.start(result.data.id);
          if (started.success && started.data?.success) {
            addToast("success", "Remote MCP server connected");
          } else if (needsOAuth(started.error || started.data?.error)) {
            onClose();
            await onAuthorize(result.data.id);
          } else {
            addToast(
              "info",
              started.data?.error || "Remote MCP server saved. Start it after authentication."
            );
          }
        } else {
          addToast("success", "MCP server added");
        }
        onSuccess();
        setName("");
        setUrl("");
        setAuthorization("");
        setArgs("");
        setEnv("");
      } else {
        throw new Error(result.error || "Failed to create");
      }
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Failed to add server");
    }
    setLoading(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add MCP Server">
      <div className="space-y-4">
        <div className="grid grid-cols-2 rounded-md bg-white/5 p-1">
          <button
            type="button"
            onClick={() => setMode("remote")}
            className={`flex items-center justify-center gap-2 rounded px-3 py-2 text-sm transition-colors ${
              mode === "remote" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            <Globe2 className="h-4 w-4" />
            Remote HTTPS
          </button>
          <button
            type="button"
            onClick={() => setMode("local")}
            className={`flex items-center justify-center gap-2 rounded px-3 py-2 text-sm transition-colors ${
              mode === "local" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            <TerminalSquare className="h-4 w-4" />
            Local command
          </button>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Server" />
        </div>
        {mode === "remote" ? (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Server URL</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://service.example.com/mcp"
                inputMode="url"
              />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-1">
                <KeyRound className="h-4 w-4" />
                Bearer token
                <span className="font-normal text-gray-500">Optional</span>
              </label>
              <Input
                type="password"
                value={authorization}
                onChange={(e) => setAuthorization(e.target.value)}
                placeholder="Token for servers without browser sign-in"
                autoComplete="off"
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Command</label>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="bunx"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Arguments</label>
              <Input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="--bun package-name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Environment Variables
              </label>
              <Input
                value={env}
                onChange={(e) => setEnv(e.target.value)}
                placeholder="API_KEY=value"
              />
            </div>
          </>
        )}
        <div className="flex gap-2 pt-4">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleSubmit} isLoading={loading} className="flex-1">
            Add Server
          </Button>
        </div>
      </div>
    </Modal>
  );
}
