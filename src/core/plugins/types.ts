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
};

export type PluginValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: CybaraPluginManifest;
};
