import { Loader2, Zap } from "lucide-react";
import { supportsCodexFastMode } from "../../../../shared/codex-fast-mode";
import { cn } from "@/lib/utils";

export function isCodexFastModeProvider(provider?: string | null): boolean {
  return typeof provider === "string" && provider.trim().toLowerCase() === "openai-codex";
}

export function shouldShowCodexFastMode(provider?: string | null, model?: string | null): boolean {
  return isCodexFastModeProvider(provider) && supportsCodexFastMode(model);
}

export function ChatFastModeToggle({
  enabled,
  provider,
  model,
  disabled,
  updating,
  onChange,
}: {
  enabled: boolean;
  provider?: string | null;
  model?: string | null;
  disabled?: boolean;
  updating?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  if (!shouldShowCodexFastMode(provider, model)) return null;

  const label = enabled ? "Fast mode on" : "Fast mode off";

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={enabled}
      disabled={disabled || updating}
      onClick={() => onChange(!enabled)}
      title={
        enabled
          ? "Fast mode: responses run about 1.5x faster and use credits faster"
          : "Fast mode: run this model about 1.5x faster for more credits"
      }
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors",
        enabled
          ? "border-amber-400/40 bg-amber-400/15 text-amber-400 hover:bg-amber-400/25"
          : "border-[var(--surface-border)] bg-[var(--surface-raised)] text-[var(--icon-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
        (disabled || updating) && "cursor-not-allowed opacity-60"
      )}
    >
      {updating ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Zap className={cn("h-3.5 w-3.5", enabled && "fill-current")} />
      )}
    </button>
  );
}
