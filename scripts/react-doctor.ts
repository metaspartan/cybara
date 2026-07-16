const REACT_DOCTOR_ARGS = [
  "x",
  "--bun",
  "react-doctor",
  ".",
  "--yes",
  "--project",
  "ui,apps/mobile",
  "--scope",
  "lines",
  "--include-untracked",
  "--no-score",
  "--no-dead-code",
  "--no-supply-chain",
  "--blocking",
  "error",
  "--max-duration",
  "60",
];

export function reactDoctorArgs(
  environment: Readonly<Record<string, string | undefined>>,
  comparisonBase?: string
): string[] {
  const args = [...REACT_DOCTOR_ARGS];
  const base = comparisonBase?.trim() || environment.REACT_DOCTOR_BASE?.trim();
  if (!base) {
    throw new Error("React Doctor requires a comparison base");
  }
  args.push("--base", base);
  return args;
}

export function resolveReactDoctorBase(
  environment: Readonly<Record<string, string | undefined>>,
  workingDirectory: string = import.meta.dir + "/.."
): string {
  const configuredBase = environment.REACT_DOCTOR_BASE?.trim();
  if (configuredBase) {
    return configuredBase;
  }
  const revision = environment.CI === "true" ? "HEAD^" : "HEAD";
  const result = Bun.spawnSync(["git", "rev-parse", revision], {
    cwd: workingDirectory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const base = result.stdout.toString().trim();
  if (result.exitCode !== 0 || !base) {
    throw new Error("Unable to resolve the comparison base for React Doctor");
  }
  return base;
}

export async function runReactDoctor(
  environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<number> {
  const workingDirectory = import.meta.dir + "/..";
  const comparisonBase = resolveReactDoctorBase(environment, workingDirectory);
  const processHandle = Bun.spawn(
    [process.execPath, ...reactDoctorArgs(environment, comparisonBase)],
    {
      cwd: workingDirectory,
      env: { ...process.env, ...environment },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }
  );
  return processHandle.exited;
}

if (import.meta.main) {
  process.exit(await runReactDoctor());
}
