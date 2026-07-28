export function getFlagValue(args: string[], ...flags: string[]): string | undefined {
  for (const flag of flags) {
    const index = args.indexOf(flag);
    if (index !== -1) return args[index + 1];
  }
  return undefined;
}

export function hasFlag(args: string[], ...flags: string[]): boolean {
  return flags.some((flag) => args.includes(flag));
}

export interface TuiLaunchSettings {
  command?: string;
  alternateScreen?: boolean;
  mouse?: boolean;
  scrollStep?: number;
}

export function parseTuiLaunchSettings(args: string[]): TuiLaunchSettings {
  const settings: TuiLaunchSettings = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index] || "";
    if (value === "--no-alt-screen") settings.alternateScreen = false;
    if (value === "--alt-screen") settings.alternateScreen = true;
    if (value === "--no-mouse") settings.mouse = false;
    if (value === "--mouse") settings.mouse = true;
    if (value === "--scroll-step") {
      const nextValue = args[index + 1];
      if (!nextValue || nextValue.startsWith("--")) continue;
      const candidate = Number(nextValue);
      if (Number.isFinite(candidate))
        settings.scrollStep = Math.min(8, Math.max(1, Math.round(candidate)));
      index += 1;
      continue;
    }
    if (value.startsWith("--scroll-step=")) {
      const candidate = Number(value.slice("--scroll-step=".length));
      if (Number.isFinite(candidate))
        settings.scrollStep = Math.min(8, Math.max(1, Math.round(candidate)));
      continue;
    }
    if (!settings.command && !value.startsWith("-")) settings.command = value;
  }

  return settings;
}
