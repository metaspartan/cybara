/**
 * Skills System Types
 * Cybara-compatible skill definitions and metadata
 */

/**
 * Installer specification for a skill dependency
 */
export type SkillInstallSpec = {
    id?: string;
    kind: "brew" | "node" | "go" | "uv" | "download" | "apt";
    label?: string;
    bins?: string[];
    os?: string[];
    // brew
    formula?: string;
    // apt
    package?: string;
    // node/go
    module?: string;
    // download
    url?: string;
    archive?: "tar.gz" | "tar.bz2" | "zip";
    extract?: boolean;
    stripComponents?: number;
    targetDir?: string;
};

/**
 * Cybara-compatible skill metadata
 * Stored as JSON in YAML frontmatter under "metadata"
 */
export type SkillMetadata = {
    /** Always include regardless of gating */
    always?: boolean;
    /** Override key for skills.entries config */
    skillKey?: string;
    /** Primary env var for apiKey shorthand */
    primaryEnv?: string;
    /** Emoji for UI display */
    emoji?: string;
    /** Homepage URL */
    homepage?: string;
    /** Limit to specific OS platforms */
    os?: ("darwin" | "linux" | "win32")[];
    /** Gating requirements */
    requires?: {
        /** All bins must exist on PATH */
        bins?: string[];
        /** At least one bin must exist */
        anyBins?: string[];
        /** All env vars must be set (or provided in config) */
        env?: string[];
        /** All config paths must be truthy */
        config?: string[];
    };
    /** Installation options */
    install?: SkillInstallSpec[];
};

/**
 * Invocation policy for skill commands
 */
export type SkillInvocationPolicy = {
    /** Can be invoked via slash command */
    userInvocable: boolean;
    /** Exclude from model prompt (only user invocable) */
    disableModelInvocation: boolean;
};

/**
 * Direct tool dispatch for skill commands
 */
export type SkillCommandDispatch = {
    kind: "tool";
    toolName: string;
    argMode?: "raw";
};

/**
 * Slash command spec derived from a skill
 */
export type SkillCommandSpec = {
    name: string;
    skillName: string;
    description: string;
    dispatch?: SkillCommandDispatch;
};

/**
 * Parsed SKILL.md frontmatter
 */
export type SkillFrontmatter = {
    name: string;
    description: string;
    metadata?: SkillMetadata;
    homepage?: string;
    "user-invocable"?: boolean;
    "disable-model-invocation"?: boolean;
    "command-dispatch"?: "tool";
    "command-tool"?: string;
    "command-arg-mode"?: "raw";
};

/**
 * Core skill definition (parsed from SKILL.md)
 */
export type Skill = {
    name: string;
    description: string;
    location: string;
    instructions: string;
};

/**
 * Full skill entry with metadata
 */
export type SkillEntry = {
    skill: Skill;
    frontmatter: SkillFrontmatter;
    metadata?: SkillMetadata;
    invocation?: SkillInvocationPolicy;
    filePath: string;
    source: "bundled" | "local" | "workspace";
};

/**
 * Context for skill eligibility checks
 */
export type SkillEligibilityContext = {
    platform: NodeJS.Platform;
    hasBin: (bin: string) => boolean;
    hasEnv: (name: string) => boolean;
    hasConfig: (path: string) => boolean;
    /** Remote node capabilities for cross-platform skills */
    remote?: {
        platforms: string[];
        hasBin: (bin: string) => boolean;
        note?: string;
    };
};

/**
 * Skill status with eligibility details
 */
export type SkillStatus = SkillEntry & {
    eligible: boolean;
    disabled: boolean;
    blockedByAllowlist: boolean;
    requirements: {
        bins: string[];
        anyBins: string[];
        env: string[];
        config: string[];
        os: string[];
    };
    missing: {
        bins: string[];
        anyBins: string[];
        env: string[];
        config: string[];
        os: string[];
    };
    install: SkillInstallSpec[];
};

/**
 * Skill snapshot for agent session
 */
export type SkillSnapshot = {
    prompt: string;
    skills: Array<{ name: string; primaryEnv?: string }>;
    resolvedSkills?: Skill[];
    version?: number;
};

/**
 * Skills configuration
 */
export type SkillsConfig = {
    /** Per-skill overrides */
    entries?: Record<string, {
        enabled?: boolean;
        apiKey?: string;
        env?: Record<string, string>;
        config?: Record<string, unknown>;
    }>;
    /** Allowlist for bundled skills */
    allowBundled?: string[];
    /** Loading configuration */
    load?: {
        /** Additional skill directories */
        extraDirs?: string[];
        /** Watch for changes */
        watch?: boolean;
        /** Debounce for watch events */
        watchDebounceMs?: number;
    };
    /** Install preferences */
    install?: {
        preferBrew?: boolean;
        nodeManager?: "npm" | "pnpm" | "yarn" | "bun";
    };
};

/**
 * Skills install preferences
 */
export type SkillsInstallPreferences = {
    preferBrew: boolean;
    nodeManager: "npm" | "pnpm" | "yarn" | "bun";
};
