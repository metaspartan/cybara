import { buildIdeUrl, resolveIdeOpenTarget } from "../../core/ide-open-target";
import { openUrlInBrowser } from "../../core/runtime/open-url";

export interface IdeCommandDependencies {
  apiBase: string;
  cwd?: string;
  openUrl?: (url: string) => Promise<void>;
  write?: (line: string) => void;
}

export async function runIdeCommand(
  args: string[],
  dependencies: IdeCommandDependencies
): Promise<string> {
  const targetValue = args.find((arg) => !arg.startsWith("-"));
  const target = resolveIdeOpenTarget(targetValue, { baseDir: dependencies.cwd });
  const url = buildIdeUrl(dependencies.apiBase, target);
  const write = dependencies.write ?? console.log;
  if (args.includes("--print")) {
    write(url);
    return url;
  }
  await (dependencies.openUrl ?? openUrlInBrowser)(url);
  write(`Opened Cybara IDE: ${target.path ?? target.workspacePath}`);
  return url;
}
