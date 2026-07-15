export type CybaraPluginSource = "bundled" | "local" | "workspace";

export type CybaraPluginContributionKind =
  | "tools"
  | "commands"
  | "hooks"
  | "mcpServers"
  | "providers"
  | "channels";

export type CybaraPluginFileContribution = {
  files?: string[];
};

export type CybaraPluginManifest = {
  schemaVersion?: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  homepage?: string;
  contributions?: {
    skills?: {
      dirs?: string[];
    };
    tools?: CybaraPluginFileContribution;
    commands?: CybaraPluginFileContribution;
    hooks?: CybaraPluginFileContribution;
    mcpServers?: CybaraPluginFileContribution;
    providers?: CybaraPluginFileContribution;
    channels?: CybaraPluginFileContribution;
  };
};

export type InstalledCybaraPlugin = {
  manifest: CybaraPluginManifest;
  rootDir: string;
  source: CybaraPluginSource;
  skillDirs: string[];
  skillNames: string[];
  contributionFiles: Record<CybaraPluginContributionKind, string[]>;
  enabled: boolean;
  builtIn: boolean;
};

export type PluginCatalogEntry = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tags: string[];
  skillNames: string[];
  installedByDefault: boolean;
  enabledByDefault: boolean;
};

export type PluginValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: CybaraPluginManifest;
};
