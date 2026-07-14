export type CybaraPluginSource = "bundled" | "local" | "workspace";

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
  };
};

export type InstalledCybaraPlugin = {
  manifest: CybaraPluginManifest;
  rootDir: string;
  source: CybaraPluginSource;
  skillDirs: string[];
  skillNames: string[];
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
