import type { LiveActivityItem } from "@/lib/chatActivities";
import { Loader2, Sparkles } from "lucide-react";
import { IdeLiveActivityTimeline } from "./IdeActivityTimeline";

interface IDEChatStatusProps {
  showWorking: boolean;
  status: "thinking" | "generating" | "idle";
  activities: LiveActivityItem[];
  currentStep: string | null;
  reverting: boolean;
}

export function IDEChatStatus({
  showWorking,
  status,
  activities,
  currentStep,
  reverting,
}: IDEChatStatusProps) {
  return (
    <>
      {showWorking && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-emerald-200/80">
            <Sparkles className="w-3 h-3" />
            Working
          </div>
          <IdeLiveActivityTimeline
            status={status}
            activities={activities}
            currentStep={currentStep}
          />
        </div>
      )}
      {reverting && (
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Reverting session...
        </div>
      )}
    </>
  );
}
