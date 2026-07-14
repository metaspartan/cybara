export type CliPluginFetch = <T>(endpoint: string, options?: RequestInit) => Promise<T | null>;

interface PluginItem {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  source: "bundled" | "local" | "workspace";
  rootDir: string;
  skillDirs: string[];
  skillCount: number;
  enabled: boolean;
}

interface CliPluginCommands {
  discover: (query?: string) => Promise<void>;
  install: (inputPath: string) => Promise<void>;
  list: () => Promise<void>;
  remove: (pluginId: string) => Promise<void>;
  setEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  validate: (inputPath: string) => Promise<void>;
}

export function createCliPluginCommands(
  fetchAPI: CliPluginFetch,
  apiBase: string
): CliPluginCommands {
  const list = async (): Promise<void> => {
    const data = await fetchAPI<{ plugins: PluginItem[] }>("/api/plugins");
    if (!data) {
      console.error("ERROR: Failed to fetch plugins from", apiBase);
      process.exit(1);
    }

    const plugins = Array.isArray(data.plugins) ? data.plugins : [];
    console.log("CYBARA PLUGINS");
    console.log("==============");
    console.log(`total: ${plugins.length}`);
    console.log("");

    if (plugins.length === 0) {
      console.log("No plugins installed");
      console.log("");
      console.log("Install one with: cybara plugin install <folder-or-zip>");
      return;
    }

    for (const plugin of plugins) {
      console.log(`- ${plugin.name} (${plugin.version})`);
      console.log(`  id: ${plugin.id}`);
      console.log(`  source: ${plugin.source}`);
      console.log(`  status: ${plugin.enabled ? "enabled" : "disabled"}`);
      console.log(`  skills: ${plugin.skillCount}`);
      console.log(`  root: ${plugin.rootDir}`);
      if (plugin.author) console.log(`  author: ${plugin.author}`);
      if (plugin.description) console.log(`  description: ${plugin.description}`);
    }
  };

  const setEnabled = async (pluginId: string, enabled: boolean): Promise<void> => {
    const data = await fetchAPI<{ success: boolean; plugin?: PluginItem }>(
      `/api/plugins/${encodeURIComponent(pluginId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }
    );
    if (!data?.success || !data.plugin) {
      console.error(`ERROR: Failed to ${enabled ? "enable" : "disable"} plugin ${pluginId}`);
      process.exit(1);
    }
    console.log(`${data.plugin.name} ${enabled ? "enabled" : "disabled"}`);
  };

  const discover = async (query = ""): Promise<void> => {
    const data = await fetchAPI<{
      plugins: Array<{
        id: string;
        name: string;
        description: string;
        tags: string[];
        skillNames: string[];
        installed: boolean;
        enabled: boolean;
      }>;
    }>("/api/plugins/catalog");
    if (!data) {
      console.error("ERROR: Failed to fetch plugin catalog from", apiBase);
      process.exit(1);
    }
    const normalized = query.trim().toLowerCase();
    const plugins = data.plugins.filter((plugin) =>
      !normalized
        ? true
        : [plugin.name, plugin.description, ...plugin.tags, ...plugin.skillNames]
            .join(" ")
            .toLowerCase()
            .includes(normalized)
    );
    console.log("PLUGIN CATALOG");
    console.log("==============");
    for (const plugin of plugins) {
      const status = plugin.installed ? (plugin.enabled ? "enabled" : "disabled") : "available";
      console.log(`- ${plugin.name} [${status}]`);
      console.log(`  id: ${plugin.id}`);
      console.log(`  skills: ${plugin.skillNames.length}`);
      console.log(`  tags: ${plugin.tags.join(", ")}`);
      console.log(`  ${plugin.description}`);
    }
    if (plugins.length === 0) console.log("No plugins found");
  };

  const validate = async (inputPath: string): Promise<void> => {
    const data = await fetchAPI<{
      valid: boolean;
      errors: string[];
      warnings: string[];
      manifest?: { id: string; name: string; version: string };
    }>("/api/plugins/validate", {
      method: "POST",
      body: JSON.stringify({ path: inputPath }),
    });

    if (!data) {
      console.error("ERROR: Failed to validate plugin path against", apiBase);
      process.exit(1);
    }

    console.log("PLUGIN VALIDATION");
    console.log("=================");
    console.log(`path: ${inputPath}`);
    console.log(`valid: ${data.valid ? "yes" : "no"}`);
    if (data.manifest) {
      console.log(`id: ${data.manifest.id}`);
      console.log(`name: ${data.manifest.name}`);
      console.log(`version: ${data.manifest.version}`);
    }
    if (data.warnings?.length) {
      console.log("");
      console.log("WARNINGS:");
      for (const warning of data.warnings) console.log(`  - ${warning}`);
    }
    if (data.errors?.length) {
      console.log("");
      console.log("ERRORS:");
      for (const error of data.errors) console.log(`  - ${error}`);
      process.exit(1);
    }
  };

  const install = async (inputPath: string): Promise<void> => {
    console.log(`Installing plugin from ${inputPath}...`);
    const data = await fetchAPI<{
      success: boolean;
      plugin?: { id: string; name: string; version: string; skillDirs: string[] };
    }>("/api/plugins/install", {
      method: "POST",
      body: JSON.stringify({ path: inputPath }),
    });

    if (!data?.success || !data.plugin) {
      console.error("ERROR: Failed to install plugin");
      process.exit(1);
    }

    console.log(`SUCCESS: Installed ${data.plugin.name}`);
    console.log(`  id: ${data.plugin.id}`);
    console.log(`  version: ${data.plugin.version}`);
    console.log(`  skill_dirs: ${data.plugin.skillDirs.length}`);
  };

  const remove = async (pluginId: string): Promise<void> => {
    const data = await fetchAPI<{ success: boolean }>(
      `/api/plugins/${encodeURIComponent(pluginId)}`,
      { method: "DELETE" }
    );

    if (!data) {
      console.error("ERROR: Failed to remove plugin from", apiBase);
      process.exit(1);
    }
    if (!data.success) {
      console.error(`Plugin not found: ${pluginId}`);
      process.exit(1);
    }
    console.log(`Removed plugin: ${pluginId}`);
  };

  return { discover, install, list, remove, setEnabled, validate };
}
