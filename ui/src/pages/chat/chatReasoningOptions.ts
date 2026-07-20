import { supportedReasoningOptions } from "@/lib/reasoning";
import type { AgentReasoningEffort } from "@/types";

export interface ChatReasoningOption {
  value: AgentReasoningEffort | null;
  label: string;
}

const EFFORT_LABELS: Record<AgentReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export function resolveChatReasoningOptions(
  provider?: string | null,
  model?: string | null,
  mode?: "adaptive" | "binary" | "effort",
  supportedEfforts?: AgentReasoningEffort[]
): ChatReasoningOption[] {
  const resolved =
    mode === "adaptive"
      ? [{ value: "" as const, label: "Adaptive" }]
      : mode === "binary"
        ? [
            { value: "" as const, label: "Default" },
            { value: "medium" as const, label: "Thinking" },
          ]
        : supportedEfforts?.length
          ? [
              { value: "" as const, label: "Default" },
              ...supportedEfforts.map((value) => ({ value, label: EFFORT_LABELS[value] })),
            ]
          : supportedReasoningOptions(provider, model);
  return resolved.map((option) => ({
    value: option.value === "" ? null : option.value,
    label: option.label,
  }));
}
