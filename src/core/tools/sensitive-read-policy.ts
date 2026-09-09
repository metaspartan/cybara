import { config, type SensitiveFilePolicyConfig } from "../config";
import type { PathPolicyOptions, SensitiveReadMode } from "./path-policy";

export function sensitiveReadMode(policy: SensitiveFilePolicyConfig): SensitiveReadMode {
  if (policy.allow_all_sensitive_reads) return "all";
  if (policy.allow_env_file_reads) return "env-files";
  return "blocked";
}

export function readablePathOptions(extra: PathPolicyOptions = {}): PathPolicyOptions {
  return { ...extra, sensitiveReads: sensitiveReadMode(config.getSensitiveFilePolicy()) };
}
