import { Loader2, Send } from "lucide-react";
import { type ReactElement, useState } from "react";
import { apiFetch } from "@/lib/auth";

export interface ClarifyQuestionOption {
  label: string;
  description?: string;
}

export interface ClarifyQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: ClarifyQuestionOption[];
}

export function clarifyQuestionFromToolCalls(
  toolCalls: Array<{ name?: string; result?: unknown; status?: string }> | undefined
): ClarifyQuestion | null {
  const call = (toolCalls || []).find(
    (toolCall) =>
      toolCall.name === "clarify" &&
      toolCall.status !== "failed" &&
      toolCall.result &&
      typeof toolCall.result === "object"
  );
  if (!call) return null;
  const result = call.result as Record<string, unknown>;
  const question = typeof result.question === "string" ? result.question.trim() : "";
  if (!question) return null;
  const rawOptions = Array.isArray(result.options) ? result.options : [];
  const options: ClarifyQuestionOption[] = [];
  for (const raw of rawOptions.slice(0, 4)) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!label) continue;
    options.push({
      label,
      description:
        typeof record.description === "string" && record.description.trim()
          ? record.description.trim()
          : undefined,
    });
  }
  return {
    question,
    header: typeof result.header === "string" ? result.header.trim() : undefined,
    multiSelect: result.multiSelect === true,
    options,
  };
}

async function sendClarifyAnswer(sessionId: string, answer: string): Promise<void> {
  await apiFetch("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message: answer, sessionId }),
  });
}

export function ClarifyQuestionCard({
  interactive,
  question,
  sessionId,
}: {
  interactive: boolean;
  question: ClarifyQuestion;
  sessionId: string | null;
}): ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState("");
  const [sending, setSending] = useState(false);

  if (!interactive || !sessionId) return null;

  const toggle = (label: string) => {
    setSelected((current) => {
      const next = new Set(question.multiSelect ? current : []);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const answer = custom.trim() ? custom.trim() : [...selected].join(", ");
  const canSend = Boolean(answer) && !sending;

  const submit = () => {
    if (!canSend) return;
    setSending(true);
    void sendClarifyAnswer(sessionId, answer)
      .catch(() => undefined)
      .finally(() => setSending(false));
  };

  return (
    <div
      className="mt-2 max-w-xl rounded-xl border border-[rgba(var(--accent-primary),0.35)] bg-[rgba(var(--accent-primary),0.06)] p-3"
      data-testid="clarify-question-card"
    >
      {question.header ? (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide accent-text">
          {question.header}
        </p>
      ) : null}
      <p className="text-sm font-medium text-[var(--text-primary)]">{question.question}</p>
      {question.options.length > 0 ? (
        <div className="mt-2.5 grid gap-1.5">
          {question.options.map((option) => {
            const active = selected.has(option.label);
            return (
              <button
                key={option.label}
                type="button"
                data-testid="clarify-question-option"
                aria-pressed={active}
                onClick={() => toggle(option.label)}
                className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "border-[rgba(var(--accent-primary),0.7)] bg-[rgba(var(--accent-primary),0.14)] text-[var(--text-primary)]"
                    : "border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/25 hover:text-[var(--text-primary)]"
                }`}
              >
                <span className="font-medium">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block text-xs text-gray-400">{option.description}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="mt-2.5 flex items-center gap-2">
        <input
          type="text"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canSend) submit();
          }}
          placeholder="Or type your own answer…"
          data-testid="clarify-question-input"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-gray-500 focus:border-[rgba(var(--accent-primary),0.6)]"
        />
        <button
          type="button"
          data-testid="clarify-question-send"
          disabled={!canSend}
          onClick={submit}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[rgba(var(--accent-primary),0.9)] px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Answer
        </button>
      </div>
    </div>
  );
}
