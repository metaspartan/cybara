import { chmodSync, existsSync } from "fs";
import { platform } from "os";

export type SystemSpeechEngine = "say" | "sapi" | "espeak-ng" | "espeak";

export interface SystemSpeechCapability {
  available: boolean;
  platform: NodeJS.Platform;
  engine: SystemSpeechEngine | null;
  command: string | null;
  label: string;
  error: string | null;
}

export interface SystemSpeechSynthesisInput {
  text: string;
  outputPath: string;
  voice?: string;
  speed?: number;
  rate?: number;
}

export interface SystemSpeechSynthesisOutput {
  outputPath: string;
  format: "aiff" | "wav";
  engine: SystemSpeechEngine;
  voice?: string;
}

type CommandResolver = (command: string) => string | null;

function defaultCommandResolver(command: string): string | null {
  return Bun.which(command);
}

export function detectSystemSpeechCapability(
  platformName: NodeJS.Platform = platform(),
  resolveCommand: CommandResolver = defaultCommandResolver
): SystemSpeechCapability {
  if (platformName === "darwin") {
    const command = resolveCommand("say");
    return command
      ? {
          available: true,
          platform: platformName,
          engine: "say",
          command,
          label: "macOS system voice",
          error: null,
        }
      : {
          available: false,
          platform: platformName,
          engine: null,
          command: null,
          label: "macOS system voice",
          error: "The macOS speech synthesizer is unavailable.",
        };
  }

  if (platformName === "win32") {
    const command = resolveCommand("powershell.exe") || resolveCommand("pwsh.exe");
    return command
      ? {
          available: true,
          platform: platformName,
          engine: "sapi",
          command,
          label: "Windows system voice",
          error: null,
        }
      : {
          available: false,
          platform: platformName,
          engine: null,
          command: null,
          label: "Windows system voice",
          error: "Windows speech synthesis is unavailable.",
        };
  }

  if (platformName === "linux") {
    const espeakNg = resolveCommand("espeak-ng");
    if (espeakNg) {
      return {
        available: true,
        platform: platformName,
        engine: "espeak-ng",
        command: espeakNg,
        label: "Linux system voice",
        error: null,
      };
    }
    const espeak = resolveCommand("espeak");
    return espeak
      ? {
          available: true,
          platform: platformName,
          engine: "espeak",
          command: espeak,
          label: "Linux system voice",
          error: null,
        }
      : {
          available: false,
          platform: platformName,
          engine: null,
          command: null,
          label: "Linux system voice",
          error: "Install espeak-ng or espeak to use the system voice.",
        };
  }

  return {
    available: false,
    platform: platformName,
    engine: null,
    command: null,
    label: "System voice",
    error: `System speech is unavailable on ${platformName}.`,
  };
}

function systemRate(input: SystemSpeechSynthesisInput): number | undefined {
  if (typeof input.rate === "number" && Number.isFinite(input.rate)) {
    return Math.max(80, Math.min(500, Math.round(input.rate)));
  }
  if (typeof input.speed === "number" && Number.isFinite(input.speed)) {
    return Math.max(80, Math.min(500, Math.round(input.speed * 175)));
  }
  return undefined;
}

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildSystemSpeechCommand(
  capability: SystemSpeechCapability,
  input: SystemSpeechSynthesisInput
): string[] {
  if (!capability.available || !capability.command || !capability.engine) {
    throw new Error(capability.error || "System speech is unavailable.");
  }
  const engine = capability.engine;
  const rate = systemRate(input);
  const voice = input.voice?.trim() || undefined;

  if (engine === "say") {
    const args = [capability.command];
    if (voice) args.push("-v", voice);
    if (rate) args.push("-r", String(rate));
    args.push("-o", input.outputPath, "--", input.text);
    return args;
  }

  if (engine === "sapi") {
    const sapiRate = rate ? Math.max(-10, Math.min(10, Math.round((rate - 175) / 18))) : 0;
    const script = [
      "Add-Type -AssemblyName System.Speech",
      "$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()",
      `$speaker.Rate = ${sapiRate}`,
      ...(voice ? [`$speaker.SelectVoice(${powerShellLiteral(voice)})`] : []),
      `$speaker.SetOutputToWaveFile(${powerShellLiteral(input.outputPath)})`,
      `$speaker.Speak(${powerShellLiteral(input.text)})`,
      "$speaker.Dispose()",
    ].join("; ");
    return [capability.command, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script];
  }

  const args = [capability.command, "-w", input.outputPath];
  if (voice) args.push("-v", voice);
  if (rate) args.push("-s", String(rate));
  args.push("--", input.text);
  return args;
}

export function synthesizeWithSystemSpeech(
  input: SystemSpeechSynthesisInput,
  capability: SystemSpeechCapability = detectSystemSpeechCapability()
): SystemSpeechSynthesisOutput {
  const command = buildSystemSpeechCommand(capability, input);
  const engine = capability.engine;
  if (!engine) throw new Error(capability.error || "System speech is unavailable.");
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0 || !existsSync(input.outputPath)) {
    const detail = result.stderr.toString().trim();
    throw new Error(detail || `${capability.label} synthesis failed.`);
  }
  try {
    chmodSync(input.outputPath, 0o600);
  } catch {
    void 0;
  }
  return {
    outputPath: input.outputPath,
    format: engine === "say" ? "aiff" : "wav",
    engine,
    voice: input.voice?.trim() || undefined,
  };
}
