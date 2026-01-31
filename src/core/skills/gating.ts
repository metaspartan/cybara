/**
 * Skills Gating
 * Eligibility checks for skill requirements (bins, env, config, os)
 */

import { execSync } from "child_process";
import { platform } from "os";
import type {
    SkillEntry,
    SkillStatus,
    SkillMetadata,
    SkillEligibilityContext,
    SkillsConfig,
} from "./types";

/**
 * Check if a binary exists on PATH
 */
export function hasBinary(bin: string): boolean {
    try {
        const cmd = platform() === "win32" ? `where ${bin}` : `which ${bin}`;
        execSync(cmd, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if an environment variable is set (or provided via config)
 */
export function hasEnvVar(name: string, config?: SkillsConfig, skillName?: string): boolean {
    // Check process.env first
    if (process.env[name]) return true;

    // Check config overrides
    if (skillName && config?.entries?.[skillName]) {
        const entry = config.entries[skillName];
        if (entry.env?.[name]) return true;
        if (entry.apiKey && skillName) {
            // Check if this is the primaryEnv for the skill
            // This would be set from metadata.primaryEnv
            return true;
        }
    }

    return false;
}

/**
 * Check if a config path is truthy
 * Supports dot notation like "browser.enabled"
 */
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

/**
 * Create an eligibility context for checking skills
 */
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

/**
 * Check if a skill meets all gating requirements
 */
export function checkSkillEligibility(
    entry: SkillEntry,
    context: SkillEligibilityContext,
    config?: SkillsConfig
): SkillStatus {
    const metadata = entry.metadata;
    const skillName = entry.skill.name;

    // Initialize status
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

    // Check disabled via config
    const disabled = config?.entries?.[skillName]?.enabled === false;

    // Check allowlist for bundled skills
    const blockedByAllowlist = entry.source === "bundled" &&
        config?.allowBundled !== undefined &&
        !config.allowBundled.includes(skillName);

    // If always=true, skip gating checks
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

    // Check OS
    if (requirements.os.length > 0) {
        const currentPlatform = context.platform;
        if (!requirements.os.includes(currentPlatform as "darwin" | "linux" | "win32")) {
            missing.os = requirements.os;
        }
    }

    // Check bins (all must exist)
    for (const bin of requirements.bins) {
        if (!context.hasBin(bin)) {
            missing.bins.push(bin);
        }
    }

    // Check anyBins (at least one must exist)
    if (requirements.anyBins.length > 0) {
        const hasAny = requirements.anyBins.some(bin => context.hasBin(bin));
        if (!hasAny) {
            missing.anyBins = requirements.anyBins;
        }
    }

    // Check env vars
    for (const envVar of requirements.env) {
        if (!context.hasEnv(envVar)) {
            missing.env.push(envVar);
        }
    }

    // Check config paths
    for (const configPath of requirements.config) {
        if (!context.hasConfig(configPath)) {
            missing.config.push(configPath);
        }
    }

    // Determine eligibility
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

/**
 * Filter skills to only eligible ones
 */
export function filterEligibleSkills(
    entries: SkillEntry[],
    context: SkillEligibilityContext,
    config?: SkillsConfig
): SkillStatus[] {
    return entries
        .map(entry => checkSkillEligibility(entry, context, config))
        .filter(status => status.eligible);
}

/**
 * Get full status report for all skills
 */
export function getSkillsStatusReport(
    entries: SkillEntry[],
    context: SkillEligibilityContext,
    config?: SkillsConfig
): SkillStatus[] {
    return entries.map(entry => checkSkillEligibility(entry, context, config));
}
