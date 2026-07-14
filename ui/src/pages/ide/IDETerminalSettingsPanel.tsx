import type { ReactElement } from "react";
import type { IdeTerminalPanelState } from "@/components/ide/EmbeddedTerminalPanel";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/utils";
import {
  IDE_TERMINAL_DEFAULT_HEIGHT,
  IDE_TERMINAL_MAX_HEIGHT,
  IDE_TERMINAL_MIN_HEIGHT,
} from "./ideConstants";
import type { IdePreferences } from "./ideTypes";

interface IDETerminalSettingsPanelProps {
  isTerminalPanelOpen: boolean;
  preferences: IdePreferences;
  terminalPanelState: IdeTerminalPanelState;
  onNewTerminal: () => void;
  onSetTerminalPanelOpen: (open: boolean) => void;
  onToggleTerminalPanel: () => void;
  onUpdatePreferences: (patch: Partial<IdePreferences>) => void;
}

export function IDETerminalSettingsPanel({
  isTerminalPanelOpen,
  preferences,
  terminalPanelState,
  onNewTerminal,
  onSetTerminalPanelOpen,
  onToggleTerminalPanel,
  onUpdatePreferences,
}: IDETerminalSettingsPanelProps): ReactElement {
  const capabilityLabel =
    terminalPanelState.capability === "checking"
      ? "Checking..."
      : terminalPanelState.capability === "enabled"
        ? "Enabled"
        : "Disabled";

  return (
    <div className="space-y-3">
      <div className="rounded border border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs">
        <div className="text-gray-200 font-medium">Terminal capability</div>
        <div
          className={cn(
            "mt-1",
            terminalPanelState.capability === "enabled"
              ? "text-emerald-300"
              : terminalPanelState.capability === "disabled"
                ? "text-amber-300"
                : "text-gray-400"
          )}
        >
          {capabilityLabel}
        </div>
        {terminalPanelState.capability === "disabled" ? (
          <div className="mt-1 text-gray-500">
            Enable it from Settings → Safety or from the terminal panel.
          </div>
        ) : null}
      </div>
      <div className="flex items-start justify-between gap-3 text-xs text-gray-300">
        <span>
          <span className="text-gray-200 font-medium">Open terminal panel on IDE startup</span>
          <span className="block text-gray-500 mt-0.5">
            Uses the stored terminal panel visibility at startup.
          </span>
        </span>
        <Switch
          checked={preferences.openTerminalOnStartup}
          onChange={(next) => {
            onUpdatePreferences({ openTerminalOnStartup: next });
            onSetTerminalPanelOpen(next);
          }}
        />
      </div>
      <div className="flex items-start justify-between gap-3 text-xs text-gray-300">
        <span>
          <span className="text-gray-200 font-medium">Auto-create terminal when panel opens</span>
          <span className="block text-gray-500 mt-0.5">Create one terminal tab automatically.</span>
        </span>
        <Switch
          checked={preferences.autoCreateTerminalOnOpen}
          onChange={(next) => onUpdatePreferences({ autoCreateTerminalOnOpen: next })}
        />
      </div>
      <label className="block text-xs text-gray-400 space-y-1.5">
        <span>Terminal panel height (px)</span>
        <input
          type="number"
          min={IDE_TERMINAL_MIN_HEIGHT}
          max={IDE_TERMINAL_MAX_HEIGHT}
          value={preferences.terminalPanelHeight}
          onChange={(event) =>
            onUpdatePreferences({
              terminalPanelHeight: Number.parseInt(
                event.target.value || String(IDE_TERMINAL_DEFAULT_HEIGHT),
                10
              ),
            })
          }
          className="w-44 rounded border border-white/10 bg-black/35 px-2 py-1.5 text-xs text-gray-100 !outline-none focus:border-indigo-500/50"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewTerminal}
          className="h-7 px-2 text-xs"
          disabled={terminalPanelState.capability !== "enabled"}
        >
          New Terminal
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleTerminalPanel}
          className="h-7 px-2 text-xs"
        >
          {isTerminalPanelOpen ? "Hide Panel" : "Show Panel"}
        </Button>
      </div>
    </div>
  );
}
