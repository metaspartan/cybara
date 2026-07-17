import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/ui/Input";
import { cn } from "@/lib/settingsFormat";
import type { CustomThemeBundle, CustomThemePalette, CustomThemeScheme } from "@/stores/uiStore";
import { themeContrastRatio } from "../../../../../shared/custom-themes";

interface CustomThemeEditorProps {
  theme: CustomThemeBundle;
  onChange: (theme: CustomThemeBundle) => void;
  onDelete: () => void;
  onSave: () => void;
  saving: boolean;
}

type PaletteKey = keyof CustomThemePalette;

const colorFields: Array<{ key: PaletteKey; label: string }> = [
  { key: "accent", label: "Accent" },
  { key: "background", label: "Background" },
  { key: "foreground", label: "Foreground" },
  { key: "panel", label: "Panel" },
  { key: "raised", label: "Raised" },
  { key: "hover", label: "Hover" },
  { key: "muted", label: "Muted text" },
  { key: "subtle", label: "Subtle text" },
  { key: "border", label: "Border" },
];

function PaletteColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 items-center justify-between gap-3 border-b border-[var(--surface-border)] py-2 text-sm last:border-b-0">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--surface-border)] bg-[var(--surface-raised)] px-2 py-1">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-5 w-5 shrink-0 cursor-pointer appearance-none overflow-hidden rounded-full border-0 bg-transparent p-0"
          aria-label={`${label} color`}
        />
        <span className="min-w-0 truncate font-mono text-xs text-[var(--text-muted)]">{value}</span>
      </span>
    </label>
  );
}

export function CustomThemeEditor({
  theme,
  onChange,
  onDelete,
  onSave,
  saving,
}: CustomThemeEditorProps) {
  const [variant, setVariant] = useState<"light" | "dark">("dark");
  const palette = theme[variant];
  const contrastRatio = themeContrastRatio(palette.foreground, palette.background);
  const updatePalette = (key: PaletteKey, value: string) => {
    onChange({ ...theme, [variant]: { ...palette, [key]: value } });
  };

  return (
    <div className="overflow-hidden rounded-md border border-[var(--surface-border)] bg-[var(--surface-panel)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--surface-border)] p-3">
        <input
          value={theme.name}
          maxLength={80}
          onChange={(event) => onChange({ ...theme, name: event.target.value })}
          className="themed-form-control min-w-40 flex-1 rounded-md border px-3 py-2 text-sm font-medium"
          aria-label="Custom theme name"
        />
        <Select
          value={theme.scheme}
          onChange={(value) => onChange({ ...theme, scheme: value as CustomThemeScheme })}
          options={[
            { value: "system", label: "Follow system" },
            { value: "light", label: "Always light" },
            { value: "dark", label: "Always dark" },
          ]}
          className="w-40"
        />
        <button
          type="button"
          onClick={onDelete}
          className="theme-muted-icon-button rounded-md p-2"
          aria-label="Delete custom theme"
          title="Delete theme"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex border-b border-[var(--surface-border)] p-1">
        {(["light", "dark"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setVariant(entry)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize",
              variant === entry
                ? "bg-[var(--surface-raised)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            )}
          >
            {entry}
          </button>
        ))}
      </div>

      <div className="grid gap-x-5 px-3 sm:grid-cols-2">
        {colorFields.map((field) => (
          <PaletteColorField
            key={field.key}
            label={field.label}
            value={palette[field.key]}
            onChange={(value) => updatePalette(field.key, value)}
          />
        ))}
      </div>

      <div className="grid gap-3 border-t border-[var(--surface-border)] p-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          <span>UI font</span>
          <input
            value={theme.uiFont}
            maxLength={160}
            onChange={(event) => onChange({ ...theme, uiFont: event.target.value })}
            className="themed-form-control w-full rounded-md border px-3 py-2 font-mono text-xs"
          />
        </label>
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          <span>Code font</span>
          <input
            value={theme.codeFont}
            maxLength={160}
            onChange={(event) => onChange({ ...theme, codeFont: event.target.value })}
            className="themed-form-control w-full rounded-md border px-3 py-2 font-mono text-xs"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-[var(--surface-border)] p-3">
        <label className="flex min-w-48 flex-1 items-center gap-3 text-xs text-[var(--text-muted)]">
          <span>Contrast</span>
          <input
            type="range"
            min="0"
            max="100"
            value={theme.contrast}
            onChange={(event) => onChange({ ...theme, contrast: Number(event.target.value) })}
            className="min-w-24 flex-1 accent-[rgb(var(--accent-primary))]"
          />
          <span className="w-7 text-right tabular-nums">{theme.contrast}</span>
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={theme.translucentSidebar}
          onClick={() => onChange({ ...theme, translucentSidebar: !theme.translucentSidebar })}
          className="flex items-center gap-2 text-xs text-[var(--text-muted)]"
        >
          <span>Translucent sidebar</span>
          <span
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
              theme.translucentSidebar
                ? "bg-[rgb(var(--accent-primary))]"
                : "bg-[var(--surface-raised)]"
            )}
          >
            <span
              className={cn(
                "h-4 w-4 rounded-full bg-white transition-transform",
                theme.translucentSidebar ? "translate-x-[18px]" : "translate-x-0.5"
              )}
            />
          </span>
        </button>
        <span
          className={cn(
            "text-xs tabular-nums",
            contrastRatio >= 4.5 ? "text-emerald-400" : "text-amber-400"
          )}
        >
          {contrastRatio.toFixed(1)}:1
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || theme.name.trim().length === 0}
          className="accent-button ml-auto rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save theme"}
        </button>
      </div>
    </div>
  );
}
