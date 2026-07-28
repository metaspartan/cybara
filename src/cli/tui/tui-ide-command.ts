import { runIdeCommand } from "../commands/ide";

export interface TuiIdeCommandOptions {
  apiBase: string;
  argument: string;
  workspaceDir: string;
}

export async function runTuiIdeCommand(options: TuiIdeCommandOptions): Promise<string> {
  let notice = "";
  await runIdeCommand(options.argument ? [options.argument] : [], {
    apiBase: options.apiBase,
    cwd: options.workspaceDir || process.cwd(),
    write: (line) => {
      notice = line;
    },
  });
  return notice;
}
