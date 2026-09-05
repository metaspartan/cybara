import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BotRosterItem } from "@/types";

const BOT_COLORS = [
  ["#a855f7", "#6d28d9"],
  ["#06b6d4", "#0e7490"],
  ["#f43f5e", "#be123c"],
  ["#22c55e", "#15803d"],
  ["#f59e0b", "#b45309"],
  ["#3b82f6", "#1d4ed8"],
] as const;

function botColorIndex(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % BOT_COLORS.length;
}

export function agentAvatarGradient(id: string): string {
  const colors = BOT_COLORS[botColorIndex(id)];
  return `linear-gradient(145deg, ${colors[0]}, ${colors[1]})`;
}

export function agentAvatarInitials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

interface BotAvatarProps {
  bot: BotRosterItem;
  active?: boolean;
  className?: string;
  showPresence?: boolean;
}

export function BotAvatar({ bot, active = false, className, showPresence = true }: BotAvatarProps) {
  return (
    <span
      className={cn(
        "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-white/15 text-sm font-semibold text-white shadow-lg",
        className
      )}
      style={{ background: agentAvatarGradient(bot.id) }}
      aria-hidden="true"
    >
      {agentAvatarInitials(bot.name) || <Bot className="h-4 w-4" />}
      {bot.profile_image ? (
        <img
          src={bot.profile_image}
          alt=""
          className="absolute inset-0 h-full w-full rounded-[inherit] object-cover"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
      {showPresence ? (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[var(--surface-primary)]",
            active ? "bg-emerald-400" : "bg-[var(--text-subtle)]"
          )}
        />
      ) : null}
    </span>
  );
}
