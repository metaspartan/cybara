import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  className?: string;
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  description,
  className,
}: SwitchProps) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
        checked ? "bg-indigo-500 border-indigo-400/60" : "bg-white/10 border-white/15",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        !label && className
      )}
      style={{ height: 22, width: 40 }}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-[21px]" : "translate-x-[3px]"
        )}
      />
    </button>
  );

  if (!label) return control;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2",
        className
      )}
    >
      <div className="min-w-0">
        <span className="text-sm text-gray-300">{label}</span>
        {description ? <p className="text-xs text-gray-500 mt-0.5">{description}</p> : null}
      </div>
      {control}
    </div>
  );
}
