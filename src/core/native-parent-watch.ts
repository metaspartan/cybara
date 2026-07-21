export function parseNativeParentProcessId(value: string | undefined): number | null {
  const parsed = Number(value?.trim());
  return Number.isSafeInteger(parsed) && parsed > 1 ? parsed : null;
}

export function nativeParentExited(
  expectedParentProcessId: number,
  currentParentProcessId: number
): boolean {
  return currentParentProcessId !== expectedParentProcessId;
}

export function processExists(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "EPERM"
    );
  }
}

export function startNativeParentWatch(
  environment: NodeJS.ProcessEnv = process.env,
  currentParentProcessId: () => number = () => process.ppid,
  exit: () => void = () => process.exit(0),
  intervalMs = 1_000,
  parentProcessExists: (processId: number) => boolean = processExists
): (() => void) | null {
  if (environment.CYBARA_NATIVE_APP !== "1") return null;
  const expectedParentProcessId = parseNativeParentProcessId(environment.CYBARA_NATIVE_PARENT_PID);
  if (expectedParentProcessId === null) return null;
  const timer = setInterval(() => {
    if (
      nativeParentExited(expectedParentProcessId, currentParentProcessId()) ||
      !parentProcessExists(expectedParentProcessId)
    ) {
      exit();
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
