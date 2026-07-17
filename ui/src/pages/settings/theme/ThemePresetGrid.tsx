import { Monitor } from "lucide-react";
import { cn } from "@/lib/settingsFormat";
import type { ThemeMode, ThemeModeOption } from "@/stores/uiStore";

interface ThemePresetGridProps {
  mode: ThemeMode;
  options: ThemeModeOption[];
  disabled: boolean;
  onSelect: (mode: ThemeMode) => void;
}

interface PreviewPalette {
  background: string;
  panel: string;
  raised: string;
  text: string;
}

function previewPalette(option: ThemeModeOption): PreviewPalette {
  if (option.value === "catppuccin") {
    return { background: "#11111b", panel: "#1e1e2e", raised: "#313244", text: "#cdd6f4" };
  }
  if (option.value === "matrix") {
    return { background: "#020804", panel: "#06120a", raised: "#0b1f10", text: "#d7ffe0" };
  }
  if (option.value === "sand-dune") {
    return { background: "#131009", panel: "#1b1610", raised: "#241d13", text: "#eee5d7" };
  }
  if (option.value === "paper") {
    return { background: "#f7f3ec", panel: "#fffefa", raised: "#efe8db", text: "#302b24" };
  }
  if (option.base === "light") {
    return { background: "#eef1f5", panel: "#ffffff", raised: "#e2e7ed", text: "#27313d" };
  }
  if (option.base === "system") {
    return { background: "#9ca3af", panel: "#f8fafc", raised: "#343944", text: "#1f2937" };
  }
  return { background: "#090b10", panel: "#13171d", raised: "#202731", text: "#edf2f7" };
}

function ThemePreview({ option }: { option: ThemeModeOption }) {
  const palette = previewPalette(option);
  const system = option.base === "system";
  return (
    <div
      className="relative h-20 overflow-hidden rounded-md border border-[var(--surface-border)]"
      style={{ background: palette.background }}
    >
      {system && (
        <div className="absolute inset-y-0 right-0 w-1/2" style={{ background: "#252933" }} />
      )}
      <div
        className="absolute inset-x-2 bottom-2 top-3 rounded-[5px]"
        style={{ background: palette.panel }}
      >
        <div
          className="absolute left-2 top-2 h-1 w-8 rounded-full opacity-70"
          style={{ background: option.swatch }}
        />
        <div
          className="absolute left-2 top-5 h-1 w-12 rounded-full opacity-35"
          style={{ background: palette.text }}
        />
        <div
          className="absolute bottom-2 left-2 right-2 h-6 rounded-[4px]"
          style={{ background: palette.raised }}
        >
          <div
            className="absolute left-2 top-2 h-1 w-7 rounded-full opacity-45"
            style={{ background: palette.text }}
          />
        </div>
      </div>
    </div>
  );
}

export function ThemePresetGrid({ mode, options, disabled, onSelect }: ThemePresetGridProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme presets"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4"
    >
      {options.map((option) => {
        const selected = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onSelect(option.value)}
            className={cn(
              "min-w-0 rounded-md border p-2 text-left transition-[border-color,background-color,transform]",
              selected
                ? "border-[rgb(var(--accent-primary))] bg-[rgba(var(--accent-primary),0.08)]"
                : "border-[var(--surface-border)] bg-[var(--surface-panel)] hover:bg-[var(--surface-hover)]",
              disabled && "cursor-not-allowed opacity-60"
            )}
          >
            <ThemePreview option={option} />
            <span className="mt-2 flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
              {option.value === "system" && <Monitor className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{option.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
