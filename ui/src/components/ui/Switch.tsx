import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  description?: string;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  ariaLabel,
  description,
  className,
}: SwitchProps) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--accent-primary),0.55)]",
        checked
          ? "border-[rgba(var(--accent-primary),0.65)] bg-[rgb(var(--accent-primary))]"
          : "border-[var(--surface-border)] bg-[var(--surface-elevated)]",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        !label && className
      )}
      style={{ height: 22, width: 40 }}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-[var(--text-primary)] shadow transition-transform duration-200",
          checked ? "translate-x-[21px]" : "translate-x-[3px]"
        )}
      />
    </button>
  );

  if (!label) return control;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-panel)] px-3 py-2",
        className
      )}
    >
      <div className="min-w-0">
        <span className="text-sm text-[var(--text-primary)]">{label}</span>
        {description ? (
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{description}</p>
        ) : null}
      </div>
      {control}
    </div>
  );
}
