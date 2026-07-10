import { commandExists } from "../../platform";

type ClipboardCommands = {
  read: string[];
  write: string[];
};

export function resolveClipboardCommands(
  platform: NodeJS.Platform = process.platform,
  hasCommand: (command: string) => boolean = commandExists
): ClipboardCommands {
  if (platform === "darwin") {
    return { read: ["pbpaste"], write: ["pbcopy"] };
  }
  if (platform === "win32") {
    return {
      read: ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"],
      write: [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$input | Set-Clipboard",
      ],
    };
  }
  if (hasCommand("wl-paste") && hasCommand("wl-copy")) {
    return { read: ["wl-paste", "--no-newline"], write: ["wl-copy"] };
  }
  if (hasCommand("xclip")) {
    return {
      read: ["xclip", "-selection", "clipboard", "-o"],
      write: ["xclip", "-selection", "clipboard"],
    };
  }
  if (hasCommand("xsel")) {
    return {
      read: ["xsel", "--clipboard", "--output"],
      write: ["xsel", "--clipboard", "--input"],
    };
  }
  throw new Error(
    "No clipboard utility found. Install wl-clipboard (Wayland) or xclip/xsel (X11)."
  );
}

async function writeClipboard(value: string): Promise<void> {
  const commands = resolveClipboardCommands();
  const proc = Bun.spawn(commands.write, { stdin: "pipe" });
  proc.stdin.write(value);
  proc.stdin.end();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error("Failed to write clipboard");
  }
}

export async function handleClipboard(
  args: Record<string, unknown>
): Promise<{ content?: string; success?: boolean }> {
  const action = args.action as "read" | "write" | "clear";
  const content = args.content as string | undefined;

  switch (action) {
    case "read": {
      const commands = resolveClipboardCommands();
      const result = Bun.spawnSync(commands.read);
      if (result.exitCode !== 0) {
        throw new Error("Failed to read clipboard");
      }
      return { content: result.stdout.toString() };
    }

    case "write": {
      if (!content) {
        throw new Error("Content is required for write action");
      }
      await writeClipboard(content);
      return { success: true };
    }

    case "clear": {
      await writeClipboard(process.platform === "win32" ? " " : "");
      return { success: true };
    }

    default:
      throw new Error(`Unknown clipboard action: ${action}`);
  }
}
