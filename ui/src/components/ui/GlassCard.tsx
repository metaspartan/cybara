import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function GlassCard({ children, className, hover = false, onClick }: GlassCardProps) {
  return (
    <div
      className={cn("glass rounded-xl p-6", hover && "glass-card-hover cursor-pointer", className)}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
