import { Diamond } from "lucide-react";
import { cn } from "@/lib/utils";

export function SubagentIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative flex items-center justify-center shrink-0", className)}
    >
      <Diamond className="h-full w-1/2" strokeWidth={2} />
      <Diamond className="h-full w-1/2 -ml-1/4" strokeWidth={2} />
    </span>
  );
}
