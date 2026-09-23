type Which = (command: string) => string | null;

let cachedHostSummary: string | undefined | null = null;

export function pythonToolingSummary(which: Which = Bun.which): string | undefined {
  const interpreter = which("python3") ? "python3" : which("python") ? "python" : undefined;
  const uv = Boolean(which("uv"));
  if (interpreter && uv) return `${interpreter}, uv for packages and venvs`;
  if (uv) return "uv run python";
  return interpreter;
}

export function hostPythonTooling(): string | undefined {
  if (cachedHostSummary === null) cachedHostSummary = pythonToolingSummary();
  return cachedHostSummary;
}
