import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, HelpCircle, Loader2 } from "lucide-react";
import type { AgentReasoningEffort } from "@/types";
import { supportedReasoningOptions } from "@/lib/reasoning";
import { cn } from "@/lib/utils";

interface ReasoningOption {
  value: AgentReasoningEffort | null;
  label: string;
}

const LEVEL_HINTS: Record<string, string> = {
  default: "Follows the provider's own setting",
  adaptive: "The model decides how much to think",
  thinking: "Enables the model's thinking mode",
  minimal: "Fastest, little to no thinking",
  low: "Quick answers with light thinking",
  medium: "Balanced speed and depth",
  high: "Deeper reasoning for harder tasks",
  "extra high": "Extensive reasoning, slower",
  max: "Maximum thinking depth, slowest",
};

export function ChatReasoningControl({
  effort,
  provider,
  model,
  disabled,
  updating,
  onChange,
}: {
  effort?: AgentReasoningEffort | null;
  provider?: string | null;
  model?: string | null;
  disabled?: boolean;
  updating?: boolean;
  onChange: (effort: AgentReasoningEffort | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [draftIndex, setDraftIndex] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const options = useMemo<ReasoningOption[]>(
    () =>
      supportedReasoningOptions(provider, model).map((option) => ({
        value: option.value === "" ? null : option.value,
        label: option.label,
      })),
    [provider, model]
  );
  const currentIndex = useMemo(() => {
    const index = options.findIndex((option) => option.value === (effort ?? null));
    return index >= 0 ? index : 0;
  }, [effort, options]);
  const label = options[currentIndex]?.label ?? "Default";
  const draftLabel = options[draftIndex]?.label ?? label;
  const maxIndex = options.length - 1;
  const ratio = maxIndex > 0 ? draftIndex / maxIndex : 0;

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
    if (!open || scrubbing || draftIndex === currentIndex) return;
    const timer = window.setTimeout(() => {
      onChange(options[draftIndex]?.value ?? null);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [currentIndex, draftIndex, onChange, open, options, scrubbing]);

  const indexFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || maxIndex <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(ratio * maxIndex);
    },
    [maxIndex]
  );

  const onTrackPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (updating) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        void 0;
      }
      setScrubbing(true);
      setDraftIndex(indexFromPointer(event.clientX));
    },
    [indexFromPointer, updating]
  );

  const onTrackPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubbing) return;
      setDraftIndex(indexFromPointer(event.clientX));
    },
    [indexFromPointer, scrubbing]
  );

  const onTrackPointerUp = useCallback(() => {
    setScrubbing(false);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        setDraftIndex((index) => Math.min(maxIndex, index + 1));
      } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        setDraftIndex((index) => Math.max(0, index - 1));
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    },
    [maxIndex]
  );

  const ariaLabel = disabled ? "Select an agent to set reasoning" : `Reasoning effort: ${label}`;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled || updating}
        onClick={() => setOpen((value) => !value)}
        className="chat-reasoning-trigger inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-transparent px-2 text-gray-400 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
        <span className="chat-reasoning-trigger-label text-[11px] font-medium">{label}</span>
      </button>
      {open ? (
        <div className="chat-reasoning-popover absolute bottom-full right-0 z-[70] mb-3 w-[264px] max-w-[calc(100vw-32px)] rounded-xl border p-3.5 shadow-2xl">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-gray-400">
              Effort <span className="font-semibold text-white">{draftLabel}</span>
            </span>
            <span
              className="relative cursor-help text-gray-500"
              onMouseEnter={() => setHelpOpen(true)}
              onMouseLeave={() => setHelpOpen(false)}
              onFocus={() => setHelpOpen(true)}
              onBlur={() => setHelpOpen(false)}
              tabIndex={0}
              aria-label="Reasoning level descriptions"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              {helpOpen ? (
                <div
                  role="tooltip"
                  className="chat-reasoning-popover absolute bottom-full right-0 z-[80] mb-2 w-[264px] rounded-xl border p-3 text-[11px] shadow-xl"
                >
                  <div className="pb-2 text-[11px] font-medium leading-4 text-gray-300">
                    How much thinking the model does before answering.
                  </div>
                  <div className="grid grid-cols-[72px_1fr] gap-x-2.5 gap-y-1.5 border-t border-white/[0.08] pt-2">
                    {options.map((option) => (
                      <div key={option.label} className="contents">
                        <span className="whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-wide text-white/90">
                          {option.label}
                        </span>
                        <span className="leading-4 text-gray-400">
                          {LEVEL_HINTS[option.label.toLowerCase()] ?? ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </span>
          </div>
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Reasoning effort"
            aria-valuemin={0}
            aria-valuemax={maxIndex}
            aria-valuenow={draftIndex}
            aria-valuetext={draftLabel}
            onPointerDown={onTrackPointerDown}
            onPointerMove={onTrackPointerMove}
            onPointerUp={onTrackPointerUp}
            onKeyDown={onKeyDown}
            className={cn(
              "relative mt-4 h-7 cursor-pointer touch-none select-none rounded-full bg-white/[0.07] outline-none ring-[rgba(var(--accent-primary),0.45)] focus-visible:ring-2",
              updating && "pointer-events-none opacity-60"
            )}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[rgb(var(--accent-primary))] to-[rgba(var(--accent-primary),0.7)] shadow-[0_0_14px_rgba(var(--accent-primary),0.5)] transition-[width] duration-150 ease-out"
              style={{ width: `calc((100% - 28px) * ${ratio} + 16px)` }}
            />
            {options.map((option, index) => (
              <span
                key={option.label}
                className={cn(
                  "absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors",
                  index <= draftIndex ? "bg-white/60" : "bg-white/25"
                )}
                style={{ left: `calc((100% - 28px) * ${index / Math.max(1, maxIndex)} + 14px)` }}
              />
            ))}
            <div
              className={cn(
                "absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] transition-[left,transform] duration-150 ease-out",
                scrubbing && "scale-110"
              )}
              style={{ left: `calc((100% - 28px) * ${ratio} + 2px)` }}
            >
              <span
                className={cn(
                  "pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/85 px-2 py-0.5 text-[11px] font-medium text-white shadow transition-opacity",
                  scrubbing ? "opacity-100" : "opacity-0"
                )}
              >
                {draftLabel}
              </span>
            </div>
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-gray-500">
            <span>Faster</span>
            <span>Smarter</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
