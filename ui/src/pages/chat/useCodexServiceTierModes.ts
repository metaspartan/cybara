import { useCallback, useState } from "react";
import { settingsApi } from "@/lib/api";
import { useUIStore } from "@/stores/uiStore";

type CodexServiceTierKey = "codex_fast_mode" | "codex_ultrafast_mode";

function useServiceTierToggle(
  key: CodexServiceTierKey,
  label: string
): [
  enabled: boolean,
  updating: boolean,
  setEnabled: (next: boolean) => Promise<void>,
  hydrate: (value: unknown) => void,
] {
  const [enabled, setEnabled] = useState(false);
  const [updating, setUpdating] = useState(false);
  const addToast = useUIStore((state) => state.addToast);

  const toggle = useCallback(
    async (next: boolean): Promise<void> => {
      if (updating) return;
      const previous = enabled;
      setEnabled(next);
      setUpdating(true);
      try {
        const result = await settingsApi.updateConfig({ [key]: next });
        if (!result.success || !result.data?.success) {
          throw new Error(result.error || "Config update failed");
        }
        addToast("success", next ? `${label} mode on` : `${label} mode off`);
      } catch (error) {
        setEnabled(previous);
        addToast(
          "error",
          error instanceof Error ? error.message : `Failed to update ${label} mode`
        );
      } finally {
        setUpdating(false);
      }
    },
    [addToast, enabled, key, label, updating]
  );

  const hydrate = useCallback(
    (value: unknown) => {
      if (!updating) setEnabled(value === true);
    },
    [updating]
  );

  return [enabled, updating, toggle, hydrate];
}

export interface CodexServiceTierModes {
  fastMode: boolean;
  fastModeUpdating: boolean;
  ultrafastMode: boolean;
  ultrafastModeUpdating: boolean;
  setFastMode: (enabled: boolean) => Promise<void>;
  setUltrafastMode: (enabled: boolean) => Promise<void>;
  syncFromConfig: (data: { codex_fast_mode?: unknown; codex_ultrafast_mode?: unknown }) => void;
}

export function useCodexServiceTierModes(): CodexServiceTierModes {
  const [fastMode, fastModeUpdating, setFastMode, hydrateFastMode] = useServiceTierToggle(
    "codex_fast_mode",
    "Fast"
  );
  const [ultrafastMode, ultrafastModeUpdating, setUltrafastMode, hydrateUltrafastMode] =
    useServiceTierToggle("codex_ultrafast_mode", "Ultra");

  const syncFromConfig = useCallback(
    (data: { codex_fast_mode?: unknown; codex_ultrafast_mode?: unknown }) => {
      hydrateFastMode(data.codex_fast_mode);
      hydrateUltrafastMode(data.codex_ultrafast_mode);
    },
    [hydrateFastMode, hydrateUltrafastMode]
  );

  return {
    fastMode,
    fastModeUpdating,
    ultrafastMode,
    ultrafastModeUpdating,
    setFastMode,
    setUltrafastMode,
    syncFromConfig,
  };
}
