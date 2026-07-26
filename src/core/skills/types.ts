export type SkillInstallSpec = {
  id?: string;
  kind: "brew" | "node" | "go" | "uv" | "download" | "apt";
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: "tar.gz" | "tar.bz2" | "zip";
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
};

export type SkillMetadata = {
  always?: boolean;
  skillKey?: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  os?: ("darwin" | "linux" | "win32")[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    anyEnv?: string[];
    config?: string[];
  };
  install?: SkillInstallSpec[];
};

export type SkillInvocationPolicy = {
  userInvocable: boolean;
  disableModelInvocation: boolean;
};

export type SkillCommandDispatch = {
  kind: "tool";
  toolName: string;
  argMode?: "raw";
};

export type SkillCommandSpec = {
  name: string;
  skillName: string;
  description: string;
  dispatch?: SkillCommandDispatch;
};

export type SkillFrontmatter = {
  name: string;
  description: string;
  metadata?: SkillMetadata;
  homepage?: string;
  license?: string;
  version?: string;
  compatibility?: string;
  "allowed-tools"?: string;
  "user-invocable"?: boolean;
  "disable-model-invocation"?: boolean;
  "command-dispatch"?: "tool";
  "command-tool"?: string;
  "command-arg-mode"?: "raw";
};

export type Skill = {
  name: string;
  description: string;
  location: string;
  instructions: string;
};

export type SkillEntry = {
  skill: Skill;
  frontmatter: SkillFrontmatter;
  metadata?: SkillMetadata;
  invocation?: SkillInvocationPolicy;
  filePath: string;
  source: "bundled" | "local" | "workspace" | "plugin";
  plugin?: {
    id: string;
    name: string;
    version: string;
    source: "bundled" | "local" | "workspace";
  };
};

export type SkillEligibilityContext = {
  platform: NodeJS.Platform;
  hasBin: (bin: string) => boolean;
  hasEnv: (name: string) => boolean;
  hasConfig: (path: string) => boolean;
  remote?: {
    platforms: string[];
    hasBin: (bin: string) => boolean;
    note?: string;
  };
};

export type SkillStatus = SkillEntry & {
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  requirements: {
    bins: string[];
    anyBins: string[];
    env: string[];
    anyEnv: string[];
    config: string[];
    os: string[];
  };
  missing: {
    bins: string[];
    anyBins: string[];
    env: string[];
    anyEnv: string[];
    config: string[];
    os: string[];
  };
  install: SkillInstallSpec[];
};

export type SkillSnapshot = {
  prompt: string;
  skills: Array<{ name: string; primaryEnv?: string }>;
  resolvedSkills?: Skill[];
  version?: number;
};

export type SkillsConfig = {
  entries?: Record<
    string,
    {
      enabled?: boolean;
      apiKey?: string;
      env?: Record<string, string>;
      config?: Record<string, unknown>;
    }
  >;
  allowBundled?: string[];
  load?: {
    extraDirs?: string[];
    watch?: boolean;
    watchDebounceMs?: number;
  };
  install?: {
    preferBrew?: boolean;
    nodeManager?: "npm" | "pnpm" | "yarn" | "bun";
  };
};

export type SkillsInstallPreferences = {
  preferBrew: boolean;
  nodeManager: "npm" | "pnpm" | "yarn" | "bun";
};
