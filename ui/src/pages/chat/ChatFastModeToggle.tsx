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
        "inline-flex h-5 w-5 shrink-0 items-center justify-center bg-transparent transition-colors",
        enabled
          ? "text-amber-400 hover:text-amber-300"
          : "text-[var(--icon-muted)] hover:text-[var(--text-primary)]",
        (disabled || updating) && "cursor-not-allowed opacity-60"
      )}
    >
      {updating ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Zap
          className={cn(
            "h-3.5 w-3.5",
            enabled && "fill-current drop-shadow-[0_0_4px_rgba(251,191,36,0.55)]"
          )}
        />
      )}
    </button>
  );
}
