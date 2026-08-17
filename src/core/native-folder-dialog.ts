import { stat } from "fs/promises";
import { platform as osPlatform } from "os";
import { commandExists } from "./platform";
import { readSubprocessStreamAsText } from "./subprocess-output";

export interface NativeFolderDialogOptions {
  defaultPath?: string;
  title?: string;
}

export interface NativeFolderDialogResult {
  path: string | null;
  supported: boolean;
}

interface FolderDialogCommand {
  argv: string[];
  env?: Record<string, string>;
}

interface NativeFolderDialogRuntime {
  commandAvailable?: (command: string) => boolean;
  platform?: NodeJS.Platform;
}

const MACOS_SCRIPT = `on run argv
set dialogTitle to item 1 of argv
set initialPath to item 2 of argv
if initialPath is "" then
  set selectedFolder to choose folder with prompt dialogTitle
else
  set selectedFolder to choose folder with prompt dialogTitle default location POSIX file initialPath
end if
return POSIX path of selectedFolder
end run`;

const WINDOWS_SCRIPT = [
  "Add-Type -AssemblyName System.Windows.Forms",
  "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
  "$dialog.Description = $env:CYBARA_FOLDER_DIALOG_TITLE",
  "$initialPath = $env:CYBARA_FOLDER_DIALOG_PATH",
  "if ($initialPath -and (Test-Path -LiteralPath $initialPath -PathType Container)) { $dialog.SelectedPath = $initialPath }",
  "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
].join("; ");

function cleanValue(value: string | undefined, maxLength: number): string {
  return (value || "").replaceAll("\0", "").trim().slice(0, maxLength);
}

function windowsPowerShell(commandAvailable: (command: string) => boolean): string | null {
  if (commandAvailable("pwsh")) return "pwsh";
  if (commandAvailable("powershell.exe")) return "powershell.exe";
  if (commandAvailable("powershell")) return "powershell";
  return null;
}

export function nativeFolderDialogCommand(
  options: NativeFolderDialogOptions,
  runtime: NativeFolderDialogRuntime = {}
): FolderDialogCommand | null {
  const title = cleanValue(options.title, 120) || "Choose Folder";
  const defaultPath = cleanValue(options.defaultPath, 4096);
  const platform = runtime.platform ?? osPlatform();
  const commandAvailable = runtime.commandAvailable ?? commandExists;

  if (platform === "darwin") {
    return { argv: ["osascript", "-e", MACOS_SCRIPT, title, defaultPath] };
  }

  if (platform === "win32") {
    const powerShell = windowsPowerShell(commandAvailable);
    if (!powerShell) return null;
    return {
      argv: [
        powerShell,
        "-NoLogo",
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        WINDOWS_SCRIPT,
      ],
      env: {
        CYBARA_FOLDER_DIALOG_PATH: defaultPath,
        CYBARA_FOLDER_DIALOG_TITLE: title,
      },
    };
  }

  if (platform === "linux" && commandAvailable("zenity")) {
    const argv = ["zenity", "--file-selection", "--directory", `--title=${title}`];
    if (defaultPath) argv.push(`--filename=${defaultPath.replace(/[\\/]?$/, "/")}`);
    return { argv };
  }

  if (platform === "linux" && commandAvailable("kdialog")) {
    return {
      argv: ["kdialog", "--getexistingdirectory", defaultPath || ".", "--title", title],
    };
  }

  return null;
}

export async function openNativeFolderDialog(
  options: NativeFolderDialogOptions
): Promise<NativeFolderDialogResult> {
  let defaultPath = options.defaultPath;
  if (defaultPath) {
    try {
      if (!(await stat(defaultPath)).isDirectory()) defaultPath = undefined;
    } catch {
      defaultPath = undefined;
    }
  }
  const command = nativeFolderDialogCommand({ ...options, defaultPath });
  if (!command) return { path: null, supported: false };

  const child = Bun.spawn(command.argv, {
    env: command.env ? { ...process.env, ...command.env } : process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout] = await Promise.all([
    child.exited,
    readSubprocessStreamAsText(child.stdout),
    readSubprocessStreamAsText(child.stderr),
  ]);
  const path = cleanValue(stdout, 4096);
  return {
    path: exitCode === 0 && path ? path.replace(/[\\/]+$/, "") : null,
    supported: true,
  };
}
