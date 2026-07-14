import type { ReactElement } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { formatBinding, IDE_ACTIONS, type IdeActionId, resolveKeymap } from "./ideKeymap";

interface IDEKeyboardSettingsPanelProps {
  isMacPlatform: boolean;
  keymapOverrides: Record<string, string>;
  recordingActionId: IdeActionId | null;
  onRecordAction: (actionId: IdeActionId | null) => void;
  onResetAction: (actionId: IdeActionId) => void;
  onResetAll: () => void;
}

export function IDEKeyboardSettingsPanel({
  isMacPlatform,
  keymapOverrides,
  recordingActionId,
  onRecordAction,
  onResetAction,
  onResetAll,
}: IDEKeyboardSettingsPanelProps): ReactElement {
  const activeKeymap = resolveKeymap(keymapOverrides);
  const categories = Array.from(new Set(IDE_ACTIONS.map((action) => action.category)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-400">
          Click a shortcut to record a new key combination. Editor keys (save, find, go to line) are
          handled in the editor.
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetAll}
          disabled={Object.keys(keymapOverrides).length === 0}
          className="h-7 px-2 text-xs"
        >
          Reset all
        </Button>
      </div>
      {categories.map((category) => (
        <div key={category} className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {category}
          </div>
          {IDE_ACTIONS.filter((action) => action.category === category).map((action) => {
            const isRecording = recordingActionId === action.id;
            const customized = action.id in keymapOverrides;
            return (
              <div
                key={action.id}
                className="flex items-center justify-between rounded border border-white/10 bg-white/[0.02] px-3 py-1.5"
              >
                <span className="text-xs text-gray-200">{action.label}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onRecordAction(isRecording ? null : action.id)}
                    className={cn(
                      "min-w-[92px] rounded border px-2 py-1 text-center font-mono text-[11px]",
                      isRecording
                        ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-200 animate-pulse"
                        : "border-white/10 bg-black/35 text-gray-100 hover:border-indigo-500/40"
                    )}
                  >
                    {isRecording
                      ? "Press keys…"
                      : formatBinding(activeKeymap[action.id], isMacPlatform)}
                  </button>
                  <button
                    type="button"
                    onClick={() => onResetAction(action.id)}
                    disabled={!customized}
                    title="Reset to default"
                    className={cn(
                      "text-[11px]",
                      customized
                        ? "text-gray-400 hover:text-gray-200"
                        : "cursor-default text-gray-700"
                    )}
                  >
                    Reset
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
