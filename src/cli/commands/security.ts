import { ensureBunRuntime } from "../../core/bun-runtime";

export const CODEX_SECURITY_PACKAGE = "@openai/codex-security@0.1.0";

export interface SecurityCommandRuntime {
  resolveBun(): Promise<string>;
  run(command: string[], cwd: string): Promise<number>;
}

const defaultRuntime: SecurityCommandRuntime = {
  resolveBun: ensureBunRuntime,
  async run(command, cwd) {
    const child = Bun.spawn(command, {
      cwd,
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return await child.exited;
  },
};

export function buildSecurityCommand(bunPath: string, args: string[]): string[] {
  return [bunPath, "x", "--bun", CODEX_SECURITY_PACKAGE, ...(args.length > 0 ? args : ["--help"])];
}

export async function runSecurityCommand(
  args: string[],
  runtime: SecurityCommandRuntime = defaultRuntime,
  cwd = process.cwd()
): Promise<number> {
  try {
    const bunPath = await runtime.resolveBun();
    return await runtime.run(buildSecurityCommand(bunPath, args), cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Unable to run the security scanner: ${message}`);
    return 1;
  }
}
