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

  return { question, header, awaiting: "user" };
}
