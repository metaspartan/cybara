import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import type {
  WebResearchSettingsStatus,
  WebSearchBackendStatus,
  WebSearchMcpBackend,
} from "@/lib/api";
import { ArrowDown, ArrowUp } from "lucide-react";

interface WebSearchBackendsPanelProps {
  status: WebResearchSettingsStatus | null;
  backends: WebSearchBackendStatus[];
  mcpBackend: WebSearchMcpBackend;
  disabled: boolean;
  onBackendsChange: (backends: WebSearchBackendStatus[]) => void;
  onMcpBackendChange: (mcpBackend: WebSearchMcpBackend) => void;
}

function moveBackend(
  backends: WebSearchBackendStatus[],
  index: number,
  offset: number
): WebSearchBackendStatus[] {
  const target = index + offset;
  if (target < 0 || target >= backends.length) return backends;
  const next = [...backends];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function WebSearchBackendsPanel({
  status,
  backends,
  mcpBackend,
  disabled,
  onBackendsChange,
  onMcpBackendChange,
}: WebSearchBackendsPanelProps) {
  const orderLocked = status?.backendOrderSource === "env";
  const toggleLocked = status?.disabledBackendsSource === "env";
  const mcpLocked = status?.mcpBackend.source === "env";
  const servers = status?.mcpServers ?? [];
  const selectedServer = servers.find(
    (server) => server.id === mcpBackend.server || server.name === mcpBackend.server
  );
  const serverOptions = [
    { value: "", label: "None" },
    ...servers.map((server) => ({
      value: server.id,
      label: server.running ? server.name : `${server.name} (stopped)`,
    })),
    ...(mcpBackend.server && !selectedServer
      ? [{ value: mcpBackend.server, label: `${mcpBackend.server} (not found)` }]
      : []),
  ];
  const toolNames = selectedServer?.tools ?? [];
  const toolOptions = [
    { value: "", label: toolNames.length > 0 ? "Select a tool" : "Start the server to list tools" },
    ...toolNames.map((tool) => ({ value: tool, label: tool })),
    ...(mcpBackend.tool && !toolNames.includes(mcpBackend.tool)
      ? [{ value: mcpBackend.tool, label: mcpBackend.tool }]
      : []),
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div>
          <div className="text-sm font-medium text-white">Search order</div>
          <p className="text-xs text-gray-400">
            web_search tries enabled, configured providers from top to bottom and falls back on
            failure. Turning a provider off keeps its key and URL.
          </p>
          {orderLocked || toggleLocked ? (
            <p className="mt-1 text-xs text-gray-400">
              {orderLocked ? "Order is managed by WEB_SEARCH_ORDER. " : ""}
              {toggleLocked ? "Enabled providers are managed by WEB_SEARCH_DISABLED." : ""}
            </p>
          ) : null}
        </div>
        <ol className="divide-y divide-white/5 rounded-lg border border-white/10 bg-white/[0.025]">
          {backends.map((backend, index) => (
            <li key={backend.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-5 text-right text-xs tabular-nums text-gray-500">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-white">{backend.label}</span>
              <Badge variant={backend.configured ? "success" : "default"}>
                {backend.configured ? "Ready" : "Not configured"}
              </Badge>
              <Switch
                checked={backend.enabled}
                ariaLabel={`Use ${backend.label}`}
                disabled={disabled || toggleLocked}
                onChange={(enabled) =>
                  onBackendsChange(
                    backends.map((item) => (item.id === backend.id ? { ...item, enabled } : item))
                  )
                }
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Move ${backend.label} up`}
                disabled={disabled || orderLocked || index === 0}
                onClick={() => onBackendsChange(moveBackend(backends, index, -1))}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Move ${backend.label} down`}
                disabled={disabled || orderLocked || index === backends.length - 1}
                onClick={() => onBackendsChange(moveBackend(backends, index, 1))}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-sm font-medium text-white">MCP search tool</div>
          <p className="text-xs text-gray-400">
            {mcpLocked
              ? "Managed by WEB_SEARCH_MCP_* environment variables."
              : "Use a tool from a connected MCP server as the MCP tool provider above."}
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Select
            label="MCP server"
            value={selectedServer?.id ?? mcpBackend.server}
            options={serverOptions}
            disabled={disabled || mcpLocked}
            onChange={(server) => onMcpBackendChange({ ...mcpBackend, server, tool: "" })}
          />
          <Select
            label="Search tool"
            value={mcpBackend.tool}
            options={toolOptions}
            disabled={disabled || mcpLocked || !mcpBackend.server}
            onChange={(tool) => onMcpBackendChange({ ...mcpBackend, tool })}
          />
          <Input
            label="Query argument"
            value={mcpBackend.queryArg}
            placeholder="query"
            disabled={disabled || mcpLocked}
            helperText="Tool argument that receives the search query"
            onChange={(event) =>
              onMcpBackendChange({ ...mcpBackend, queryArg: event.target.value })
            }
          />
          <Input
            label="Result count argument"
            value={mcpBackend.countArg}
            placeholder="Optional, e.g. max_results"
            disabled={disabled || mcpLocked}
            helperText="Leave empty if the tool has no result limit argument"
            onChange={(event) =>
              onMcpBackendChange({ ...mcpBackend, countArg: event.target.value })
            }
          />
        </div>
      </div>
    </div>
  );
}
