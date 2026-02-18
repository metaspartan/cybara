
import { platform } from "os";
import type {
    SkillEntry,
    SkillStatus,
    SkillEligibilityContext,
    SkillsConfig,
} from "./types";

export function hasBinary(bin: string): boolean {
    if (!bin || typeof bin !== "string") return false;
    try {
        const checkCmd = platform() === "win32" ? "where" : "which";
        const result = Bun.spawnSync([checkCmd, bin], {
            stdout: "ignore",
            stderr: "ignore",
        });
        return (result.exitCode ?? 1) === 0;
    } catch {
        return false;
    }
}

export function hasEnvVar(name: string, config?: SkillsConfig, skillName?: string): boolean {
    if (process.env[name]) return true;

    if (skillName && config?.entries?.[skillName]) {
        const entry = config.entries[skillName];
        if (entry.env?.[name]) return true;
        if (entry.apiKey && skillName) {
            return true;
        }
    }

    return false;
}

export function hasConfigPath(path: string, config?: Record<string, unknown>): boolean {
    if (!config) return false;

    const parts = path.split(".");
    let current: unknown = config;

    for (const part of parts) {
        if (current === null || current === undefined) return false;
        if (typeof current !== "object") return false;
        current = (current as Record<string, unknown>)[part];
    }

    return Boolean(current);
}

export function createEligibilityContext(
    config?: Record<string, unknown>,
    skillsConfig?: SkillsConfig
): SkillEligibilityContext {
    return {
        platform: platform(),
        hasBin: hasBinary,
        hasEnv: (name: string) => hasEnvVar(name, skillsConfig),
        hasConfig: (path: string) => hasConfigPath(path, config),
    };
}

export function checkSkillEligibility(
    entry: SkillEntry,
    context: SkillEligibilityContext,
    config?: SkillsConfig
): SkillStatus {
    const metadata = entry.metadata;
    const skillName = entry.skill.name;

    const requirements = {
        bins: metadata?.requires?.bins ?? [],
        anyBins: metadata?.requires?.anyBins ?? [],
        env: metadata?.requires?.env ?? [],
        config: metadata?.requires?.config ?? [],
        os: metadata?.os ?? [],
    };

    const missing = {
        bins: [] as string[],
        anyBins: [] as string[],
        env: [] as string[],
        config: [] as string[],
        os: [] as string[],
    };

    const disabled = config?.entries?.[skillName]?.enabled === false;

    const blockedByAllowlist = entry.source === "bundled" &&
        config?.allowBundled !== undefined &&
        !config.allowBundled.includes(skillName);

    if (metadata?.always) {
        return {
            ...entry,
            eligible: !disabled && !blockedByAllowlist,
            disabled,
            blockedByAllowlist,
            requirements,
            missing,
            install: metadata?.install ?? [],
        };
    }

    if (requirements.os.length > 0) {
        const currentPlatform = context.platform;
        if (!requirements.os.includes(currentPlatform as "darwin" | "linux" | "win32")) {
            missing.os = requirements.os;
        }
    }

    for (const bin of requirements.bins) {
        if (!context.hasBin(bin)) {
            missing.bins.push(bin);
        }
    }

    if (requirements.anyBins.length > 0) {
        const hasAny = requirements.anyBins.some(bin => context.hasBin(bin));
        if (!hasAny) {
            missing.anyBins = requirements.anyBins;
        }
    }

    for (const envVar of requirements.env) {
        if (!context.hasEnv(envVar)) {
            missing.env.push(envVar);
        }
    }

    for (const configPath of requirements.config) {
        if (!context.hasConfig(configPath)) {
            missing.config.push(configPath);
        }
    }

    const hasMissing =
        missing.bins.length > 0 ||
        missing.anyBins.length > 0 ||
        missing.env.length > 0 ||
        missing.config.length > 0 ||
        missing.os.length > 0;

    const eligible = !disabled && !blockedByAllowlist && !hasMissing;

    return {
        ...entry,
        eligible,
        disabled,
        blockedByAllowlist,
        requirements,
        missing,
        install: metadata?.install ?? [],
    };
}

export function filterEligibleSkills(
    entries: SkillEntry[],
    context: SkillEligibilityContext,
    config?: SkillsConfig
): SkillStatus[] {
    return entries
        .map(entry => checkSkillEligibility(entry, context, config))
        .filter(status => status.eligible);
}

export function getSkillsStatusReport(
    entries: SkillEntry[],
    context: SkillEligibilityContext,
    config?: SkillsConfig
): SkillStatus[] {
    return entries.map(entry => checkSkillEligibility(entry, context, config));
}
