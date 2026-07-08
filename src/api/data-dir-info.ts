import { resolveCybaraHome } from "../core/cybara-home";
import { cybaraDir } from "../core/paths";

export function getCybaraDataDirInfo(): Record<string, unknown> {
  const configured = resolveCybaraHome();
  return {
    cybaraDataDir: cybaraDir,
    configuredCybaraDataDir: configured.dir,
    cybaraDataDirSource: configured.source,
    cybaraDataDirForced: configured.forced,
    cybaraDataDirRestartRequired: configured.dir !== cybaraDir,
    cybaraDataDirOverrideFile: configured.overrideFile,
    defaultCybaraDataDir: configured.defaultDir,
  };
}

export function getCybaraDataDirConfigInfo(): Record<string, unknown> {
  const info = getCybaraDataDirInfo();
  return {
    cybara_data_dir: info.cybaraDataDir,
    configured_cybara_data_dir: info.configuredCybaraDataDir,
    cybara_data_dir_source: info.cybaraDataDirSource,
    cybara_data_dir_forced: info.cybaraDataDirForced,
    cybara_data_dir_restart_required: info.cybaraDataDirRestartRequired,
    cybara_data_dir_override_file: info.cybaraDataDirOverrideFile,
    default_cybara_data_dir: info.defaultCybaraDataDir,
  };
}
