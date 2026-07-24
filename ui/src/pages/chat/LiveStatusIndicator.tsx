import { cn } from "@/lib/utils";
import type { ReactElement, ReactNode } from "react";
import { type OrbSize, type OrbState, ThinkingOrb } from "thinking-orbs";

interface LiveStatusIndicatorProps {
  className?: string;
  text: string;
}

interface LiveStatusOrbProps {
  className?: string;
  size?: OrbSize;
  state: OrbState;
}

interface LiveStatusTextProps {
  children: ReactNode;
  className?: string;
}

function resolveLiveStatusOrbState(text: string): OrbState {
  return text === "Generating response..." ? "solving" : "composing";
}

export function LiveStatusOrb({ className, size = 20, state }: LiveStatusOrbProps): ReactElement {
  return (
    <ThinkingOrb
      state={state}
      size={size}
      width={size}
      height={size}
      theme="auto"
      role="presentation"
      aria-hidden="true"
      data-orb-state={state}
      className={cn("shrink-0", className)}
    />
  );
}

export function LiveStatusText({ children, className }: LiveStatusTextProps): ReactElement {
  return (
    <span className={cn("live-status-shine min-w-0 whitespace-pre-wrap break-words", className)}>
      {children}
    </span>
  );
}

export function LiveStatusIndicator({ className, text }: LiveStatusIndicatorProps): ReactElement {
  const orbState = resolveLiveStatusOrbState(text);

  return (
    <div className={cn("live-status-indicator flex min-w-0 items-center gap-1.5", className)}>
      <LiveStatusOrb state={orbState} size={20} className="live-status-orb" />
      <LiveStatusText>{text}</LiveStatusText>
    </div>
  );
}
