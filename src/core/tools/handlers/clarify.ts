/**
 * `clarify` tool — ask the user a structured clarifying question.
 *
 * Ports hermes's `clarify` tool: the model can pause and request a decision
 * when a task is ambiguous, presenting up to 4 multiple-choice options OR an
 * open-ended question. This surfaces a clean prompt in the conversation rather
 * than the model guessing and proceeding on a wrong assumption.
 *
 * The tool *returns* the question as a structured payload (rendered by the UI);
 * the agent loop treats the pending user reply as the next turn. It does not
 * block — it emits the question and the host (TUI/web) is responsible for
 * collecting the answer.
 */
export interface ClarifyOption {
  label: string;
  description?: string;
}

export async function handleClarify(args: Record<string, unknown>): Promise<{
  question: string;
  options?: ClarifyOption[];
  header?: string;
  multiSelect?: boolean;
  awaiting: "user";
}> {
  const question = typeof args.question === "string" ? args.question.trim() : "";

  if (!question) {
    throw new Error(
      'Validation error: a \'question\' string is required (e.g. {"question":"Which approach?"}).'
    );
  }

  const header =
    typeof args.header === "string" && args.header.trim()
      ? args.header.trim().slice(0, 60)
      : undefined;

  const rawOptions = Array.isArray(args.options) ? (args.options as unknown[]) : [];
  const options: ClarifyOption[] = [];
  for (const raw of rawOptions.slice(0, 4)) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    if (!label) continue;
    const description = typeof obj.description === "string" ? obj.description.trim() : undefined;
    options.push({ label, description });
  }

  if (options.length > 0) {
    return {
      question,
      options,
      header,
      multiSelect: args.multiSelect === true,
      awaiting: "user",
    };
  }

  // Open-ended question (no options).
  return { question, header, awaiting: "user" };
}
