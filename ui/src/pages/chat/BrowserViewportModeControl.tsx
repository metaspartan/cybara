import { Monitor, Scan, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { BROWSER_VIEWPORT_PRESETS, type BrowserViewportMode } from "./browserViewportMode";

const VIEWPORT_MODES: Array<{
  mode: BrowserViewportMode;
  label: string;
  icon: typeof Monitor;
}> = [
  { mode: "responsive", label: "Responsive viewport", icon: Scan },
  {
    mode: "mobile",
    label: `Mobile viewport ${BROWSER_VIEWPORT_PRESETS.mobile.width} by ${BROWSER_VIEWPORT_PRESETS.mobile.height}`,
    icon: Smartphone,
  },
  {
    mode: "desktop",
    label: `Desktop viewport ${BROWSER_VIEWPORT_PRESETS.desktop.width} by ${BROWSER_VIEWPORT_PRESETS.desktop.height}`,
    icon: Monitor,
  },
];

export function BrowserViewportModeControl({
  mode,
  onChange,
}: {
  mode: BrowserViewportMode;
  onChange: (mode: BrowserViewportMode) => void;
}) {
  return (
    <div
      className="flex h-7 shrink-0 items-center rounded-md border border-[var(--surface-border)] bg-[var(--surface-muted)] p-0.5"
      role="group"
      aria-label="Browser viewport"
    >
      {VIEWPORT_MODES.map((item) => {
        const Icon = item.icon;
        const selected = mode === item.mode;
        return (
          <button
            key={item.mode}
            type="button"
            className={cn(
              "flex h-5 w-6 items-center justify-center rounded-[4px] text-[var(--text-muted)] transition-colors",
              selected
                ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-sm"
                : "hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-secondary)]"
            )}
            aria-label={item.label}
            aria-pressed={selected}
            title={item.label}
            data-testid={`browser-viewport-mode-${item.mode}`}
            onClick={() => onChange(item.mode)}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
