import type { ProviderPlanUsageLevel } from "@/lib/providerPlanDisplay";

const LEVEL_COLORS: Record<ProviderPlanUsageLevel, string> = {
  unknown: "rgba(148, 163, 184, 0.45)",
  green: "#6ee7b7",
  blue: "#7dd3fc",
  yellow: "#fde047",
  orange: "#fdba74",
  red: "#fca5a5",
};

const LEVEL_TEXT: Record<ProviderPlanUsageLevel, string> = {
  unknown: "text-gray-500",
  green: "text-emerald-200",
  blue: "text-sky-200",
  yellow: "text-yellow-200",
  orange: "text-orange-200",
  red: "text-red-200",
};

export interface UsageGaugeProps {
  percent: number | null;
  unlimited?: boolean;
  value: string;
  label: string;
  level: ProviderPlanUsageLevel;
  size?: number;
  className?: string;
}

export function UsageGauge({
  percent,
  unlimited,
  value,
  label,
  level,
  size = 96,
  className,
}: UsageGaugeProps) {
  const effective = unlimited ? 100 : (percent ?? 0);
  const clamped = Math.max(0, Math.min(100, effective));
  const color = LEVEL_COLORS[level];
  const track = "rgba(255, 255, 255, 0.08)";
  const degrees = clamped * 3.6;
  const ringWidth = Math.max(8, size * 0.1);
  const inner = size - ringWidth * 2;

  return (
    <div className={className} style={{ width: size, height: size }}>
      <div
        className="relative"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: `conic-gradient(${color} ${degrees}deg, ${track} 0deg)`,
        }}
      >
        <div
          className="absolute inset-0 m-auto flex flex-col items-center justify-center rounded-full bg-[#101018]"
          style={{ width: inner, height: inner, top: ringWidth, left: ringWidth }}
        >
          <span className={`text-base font-bold tabular-nums leading-none ${LEVEL_TEXT[level]}`}>
            {value}
          </span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
