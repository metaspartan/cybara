import { Diamond } from "lucide-react";
import { cn } from "@/lib/utils";

export function SubagentIcon({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative block shrink-0", className)}>
      <Diamond
        className="absolute left-0 top-1/2 h-[72%] w-[72%] -translate-y-1/2"
        strokeWidth={2}
      />
      <Diamond
        className="absolute right-0 top-1/2 h-[72%] w-[72%] -translate-y-1/2"
        strokeWidth={2}
      />
    </span>
  );
}
