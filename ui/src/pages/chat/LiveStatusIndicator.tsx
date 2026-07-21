import { cn } from "@/lib/utils";
import type { ReactElement } from "react";
import { type OrbState, ThinkingOrb } from "thinking-orbs";

interface LiveStatusIndicatorProps {
  className?: string;
  text: string;
}

function resolveLiveStatusOrbState(text: string): OrbState {
  return text === "Generating response..." ? "solving" : "composing";
}

export function LiveStatusIndicator({ className, text }: LiveStatusIndicatorProps): ReactElement {
  const orbState = resolveLiveStatusOrbState(text);

  return (
    <div className={cn("live-status-indicator flex min-w-0 items-start gap-1.5", className)}>
      <ThinkingOrb
        state={orbState}
        size={20}
        width={20}
        height={20}
        theme="auto"
        role="presentation"
        aria-hidden="true"
        data-orb-state={orbState}
        className="live-status-orb shrink-0"
      />
      <span className="live-status-shine min-w-0 whitespace-pre-wrap break-words">{text}</span>
    </div>
  );
}
