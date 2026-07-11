import { Puzzle, Wrench, Plug, Server, Bot } from "lucide-react";
import type { ChatCapabilityOption } from "@/lib/api";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<string, typeof Wrench> = {
  skill: Puzzle,
  mcp_server: Server,
  mcp: Plug,
  agent: Bot,
  tool: Wrench,
};

const KIND_LABEL: Record<string, string> = {
  skill: "Skill",
  mcp_server: "MCP server",
  mcp: "MCP tool",
  agent: "Agent",
  tool: "Tool",
};

interface ChatCapabilityMenuProps {
  options: ChatCapabilityOption[];
  selectedIndex: number;
  loading: boolean;
  onSelect: (option: ChatCapabilityOption) => void;
}

export function ChatCapabilityMenu({
  options,
  selectedIndex,
  loading,
  onSelect,
}: ChatCapabilityMenuProps) {
  return (
    <div
      className="absolute bottom-full left-0 right-0 z-40 mb-2 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-[var(--surface-panel,#15161c)] p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
      role="listbox"
      aria-label="Chat capabilities"
    >
      {loading ? (
        <div className="px-3 py-3 text-xs text-gray-400">Loading capabilities...</div>
      ) : options.length === 0 ? (
        <div className="px-3 py-3 text-xs text-gray-400">
          No matching skills, MCP servers, agents, or tools
        </div>
      ) : (
        options.map((option, index) => {
          const Icon = KIND_ICON[option.kind] ?? Wrench;
          return (
            <button
              key={`${option.kind}:${option.token}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(option)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                index === selectedIndex ? "bg-white/10" : "hover:bg-white/5"
              )}
            >
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-xs font-medium text-gray-100">{option.token}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-500">
                    {KIND_LABEL[option.kind] ?? option.source}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-gray-400">
                  {option.description}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
