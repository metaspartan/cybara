type Which = (command: string) => string | null;

const MISSING_COMMAND_PATTERNS = [
  /(?:^|[\s:])(python|pip3?)(?::\s*command not found|: not found)/m,
  /command not found: (python|pip3?)$/m,
];
const EXTERNALLY_MANAGED_PATTERN = /externally-managed-environment/;
const MISSING_MODULE_PATTERN = /ModuleNotFoundError: No module named '([\w.]+)'/;

function missingCommand(output: string): string | undefined {
  return MISSING_COMMAND_PATTERNS.map((pattern) => pattern.exec(output)?.[1]).find(Boolean);
}

function missingCommandHint(output: string, which: Which): string {
  const missing = missingCommand(output);
  if (!missing) return "";
  if (missing.startsWith("pip")) {
    if (which("uv")) return `${missing} is not installed here; use uv pip install instead.`;
    return which("python3") ? `${missing} is not installed here; use python3 -m pip instead.` : "";
  }
  return which("python3") ? `${missing} is not installed here; use python3 instead.` : "";
}

function uvPackageHint(output: string, which: Which): string {
  if (!which("uv")) return "";
  if (EXTERNALLY_MANAGED_PATTERN.test(output)) {
    return "System Python is managed; use uv venv then uv pip install, or uv run --with <package> python3 script.py.";
  }
  const module = MISSING_MODULE_PATTERN.exec(output)?.[1];
  if (!module) return "";
  const topLevel = module.split(".")[0];
  return `To use ${topLevel} without a global install, run uv run --with <package> python3 script.py (the package name can differ from the module name).`;
}

export function execFailureHint(
  exitCode: number,
  output: string,
  which: Which = Bun.which
): string {
  if (exitCode === 0) return "";
  const hint = exitCode === 127 ? missingCommandHint(output, which) : uvPackageHint(output, which);
  return hint ? `\n${hint}` : "";
}
