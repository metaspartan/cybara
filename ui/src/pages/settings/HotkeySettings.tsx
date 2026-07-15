import { Keyboard, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  APP_HOTKEYS,
  bindingFromKeyboardEvent,
  formatAppHotkey,
  readAppHotkeyOverrides,
  resolveAppHotkeys,
  writeAppHotkeyOverrides,
  type AppHotkeyActionId,
} from "@/lib/appHotkeys";
import { cn } from "@/lib/utils";

export function HotkeySettings(): ReactElement {
  const [overrides, setOverrides] = useState(readAppHotkeyOverrides);
  const [recording, setRecording] = useState<AppHotkeyActionId | null>(null);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const bindings = useMemo(() => resolveAppHotkeys(overrides), [overrides]);
  const categories = useMemo(
    () => Array.from(new Set(APP_HOTKEYS.map((definition) => definition.category))),
    []
  );

  useEffect(() => {
    if (!recording) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey) return;
      const binding = bindingFromKeyboardEvent(event);
      if (!binding) return;
      const next = { ...overrides, [recording]: binding };
      setOverrides(next);
      writeAppHotkeyOverrides(next);
      setRecording(null);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [overrides, recording]);

  const reset = (id: AppHotkeyActionId) => {
    const next = { ...overrides };
    delete next[id];
    setOverrides(next);
    writeAppHotkeyOverrides(next);
  };

  const resetAll = () => {
    setOverrides({});
    writeAppHotkeyOverrides({});
    setRecording(null);
  };

  return (
    <Card variant="liquid">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Keyboard className="h-5 w-5 text-[rgb(var(--accent-primary))]" />
          Hotkeys
        </CardTitle>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={resetAll}
          disabled={Object.keys(overrides).length === 0}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset all
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {categories.map((category) => (
          <section key={category} className="space-y-2">
            <h3 className="text-xs font-medium uppercase text-[var(--text-muted)]">{category}</h3>
            <div className="divide-y divide-[var(--surface-border)] rounded-md bg-[var(--surface-raised)]">
              {APP_HOTKEYS.filter((definition) => definition.category === category).map(
                (definition) => {
                  const customized = definition.id in overrides;
                  const isRecording = recording === definition.id;
                  return (
                    <div
                      key={definition.id}
                      className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="text-sm text-[var(--context-tooltip-body)]">
                        {definition.label}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setRecording(isRecording ? null : definition.id)}
                          className={cn(
                            "min-w-24 rounded-md px-2.5 py-1.5 text-center font-mono text-xs transition-colors",
                            isRecording
                              ? "bg-[rgba(var(--accent-primary),0.18)] text-[rgb(var(--accent-primary))]"
                              : "bg-[var(--surface-panel)] text-[var(--context-tooltip-body)] hover:bg-[rgba(var(--accent-primary),0.1)]"
                          )}
                        >
                          {isRecording
                            ? "Press keys"
                            : formatAppHotkey(bindings[definition.id], isMac)}
                        </button>
                        <button
                          type="button"
                          disabled={!customized}
                          onClick={() => reset(definition.id)}
                          className={cn(
                            "text-xs",
                            customized
                              ? "text-[var(--text-muted)] hover:text-[var(--context-tooltip-body)]"
                              : "text-[var(--text-subtle)] opacity-40"
                          )}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
