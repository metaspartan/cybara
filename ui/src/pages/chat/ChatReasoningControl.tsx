import { useEffect, useRef, useState } from "react";
import { BrainCircuit, Loader2 } from "lucide-react";
import type { AgentReasoningEffort } from "@/types";

const reasoningOptions: Array<{
  value: AgentReasoningEffort | null;
  label: string;
}> = [
  { value: null, label: "Default" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Max" },
];

function reasoningIndex(effort?: AgentReasoningEffort | null): number {
  const index = reasoningOptions.findIndex((option) => option.value === (effort ?? null));
  return index >= 0 ? index : 0;
}

function reasoningLabel(effort?: AgentReasoningEffort | null): string {
  return reasoningOptions[reasoningIndex(effort)]?.label ?? "Default";
}

export function ChatReasoningControl({
  effort,
  disabled,
  updating,
  onChange,
}: {
  effort?: AgentReasoningEffort | null;
  disabled?: boolean;
  updating?: boolean;
  onChange: (effort: AgentReasoningEffort | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftIndex, setDraftIndex] = useState(() => reasoningIndex(effort));
  const rootRef = useRef<HTMLDivElement>(null);
  const currentIndex = reasoningIndex(effort);
  const label = reasoningLabel(effort);

  useEffect(() => {
    setDraftIndex(currentIndex);
  }, [currentIndex]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (!open || draftIndex === currentIndex) return;
    const timer = window.setTimeout(() => {
      onChange(reasoningOptions[draftIndex]?.value ?? null);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [currentIndex, draftIndex, onChange, open]);

  const title = disabled ? "Select an agent to set reasoning" : `Reasoning: ${label}`;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled || updating}
        onClick={() => setOpen((value) => !value)}
        className="chat-reasoning-trigger inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-transparent px-2 text-gray-400 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
        title={title}
        aria-label={title}
        aria-expanded={open}
      >
        {updating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <BrainCircuit className="h-4 w-4" />
        )}
        <span className="chat-reasoning-trigger-label text-[11px] font-medium">{label}</span>
      </button>
      {open ? (
        <div className="chat-reasoning-popover absolute bottom-full right-0 z-[70] mb-3 w-[250px] max-w-[calc(100vw-32px)] rounded-lg border p-3 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium">Reasoning</span>
            <span className="text-xs font-semibold text-white">
              {reasoningOptions[draftIndex]?.label}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={reasoningOptions.length - 1}
            step={1}
            list="chat-reasoning-levels"
            value={draftIndex}
            disabled={updating}
            onChange={(event) => setDraftIndex(Number(event.target.value))}
            className="chat-reasoning-slider mt-3 w-full"
            aria-label="Reasoning effort"
            aria-valuetext={reasoningOptions[draftIndex]?.label}
          />
          <datalist id="chat-reasoning-levels">
            {reasoningOptions.map((option, index) => (
              <option key={option.label} value={index} label={option.label} />
            ))}
          </datalist>
          <div className="mt-1 flex justify-between text-[10px] text-gray-400">
            <span>Default</span>
            <span>Smarter</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
