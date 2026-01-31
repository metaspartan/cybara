import { tables } from "./database";

interface PlatformConfig {
  name: string;
  host: string;
  port: number;
  session_secret?: string;
  [key: string]: unknown;
}

class ConfigManager {
  get<T>(key: string): T | undefined {
    const stored = tables.config.get(key);
    if (stored) {
      try {
        return JSON.parse(stored.value) as T;
      } catch {
        return stored.value as unknown as T;
      }
    }
    return undefined;
  }

  set<T>(key: string, value: T): void {
    tables.config.set(key, JSON.stringify(value));
  }

  getAll(): PlatformConfig {
    const defaults: PlatformConfig = {
      name: "Cybara",
      host: "0.0.0.0",
      port: 3000,
    };

    const all = tables.config.all();
    const config: PlatformConfig = { ...defaults };

    for (const { key, value } of all) {
      try {
        config[key] = JSON.parse(value);
      } catch {
        config[key] = value;
      }
    }
    return config;
  }

  isSetupComplete(): boolean {
    return tables.setup.isComplete();
  }

  completeSetup(): void {
    tables.setup.setStep(
      "wizard",
      true,
      JSON.stringify({ completed_at: new Date().toISOString() })
    );
  }

  getSetupStep(): string {
    const step = tables.setup.getStep("wizard") as { config?: string } | null;
    if (!step) return "welcome";
    try {
      const stepConfig = step.config ? JSON.parse(step.config) : {};
      return stepConfig.current_step || "welcome";
    } catch {
      return "welcome";
    }
  }
}

export const config = new ConfigManager();
