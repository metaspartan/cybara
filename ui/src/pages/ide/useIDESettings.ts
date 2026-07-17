import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  bindingFromEvent,
  type IdeActionId,
  loadKeymapOverrides,
  persistKeymapOverrides,
} from "./ideKeymap";
import {
  clampTerminalHeight,
  persistIdePreferences,
  readPersistedIdePreferences,
} from "./idePersistence";
import type { IdePreferences, IdeSettingsSectionId } from "./ideTypes";

interface IdeSettingsSection {
  id: IdeSettingsSectionId;
  label: string;
  description: string;
}

const settingsSections: IdeSettingsSection[] = [
  {
    id: "general",
    label: "General",
    description: "Workspace and layout defaults",
  },
  { id: "editor", label: "Editor", description: "Font, line-height, minimap" },
  {
    id: "indexing",
    label: "Indexing",
    description: "Workspace index and semantic search",
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    description: "Customize keyboard shortcuts",
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Integrated terminal behavior",
  },
];

interface IDESettingsController {
  keymapOverrides: Record<string, string>;
  recordingActionId: IdeActionId | null;
  setRecordingActionId: Dispatch<SetStateAction<IdeActionId | null>>;
  isMacPlatform: boolean;
  showIdeSettings: boolean;
  setShowIdeSettings: Dispatch<SetStateAction<boolean>>;
  ideSettingsSection: IdeSettingsSectionId;
  setIdeSettingsSection: Dispatch<SetStateAction<IdeSettingsSectionId>>;
  ideSettingsSearch: string;
  setIdeSettingsSearch: Dispatch<SetStateAction<string>>;
  idePreferences: IdePreferences;
  setIdePreferences: Dispatch<SetStateAction<IdePreferences>>;
  settingsSearchRef: RefObject<HTMLInputElement | null>;
  openIdeSettings: (section?: IdeSettingsSectionId) => void;
  updateIdePreferences: (patch: Partial<IdePreferences>) => void;
  resetKeymapAction: (id: IdeActionId) => void;
  resetAllKeymap: () => void;
  normalizedSettingsSearch: string;
  matchesIdeSettingsSearch: (...parts: string[]) => boolean;
  settingsSections: IdeSettingsSection[];
  visibleSettingsSectionIds: IdeSettingsSectionId[];
}

export function useIDESettings(): IDESettingsController {
  const [keymapOverrides, setKeymapOverrides] = useState<Record<string, string>>(() =>
    loadKeymapOverrides()
  );
  const [recordingActionId, setRecordingActionId] = useState<IdeActionId | null>(null);
  const isMacPlatform =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  const [showIdeSettings, setShowIdeSettings] = useState(false);
  const [ideSettingsSection, setIdeSettingsSection] = useState<IdeSettingsSectionId>("general");
  const [ideSettingsSearch, setIdeSettingsSearch] = useState("");
  const [idePreferences, setIdePreferences] = useState<IdePreferences>(() =>
    readPersistedIdePreferences()
  );
  const settingsSearchRef = useRef<HTMLInputElement | null>(null);

  const openIdeSettings = useCallback((section: IdeSettingsSectionId = "general") => {
    setIdeSettingsSection(section);
    setShowIdeSettings(true);
    setIdeSettingsSearch("");
    window.requestAnimationFrame(() => {
      settingsSearchRef.current?.focus();
      settingsSearchRef.current?.select();
    });
  }, []);

  const updateIdePreferences = useCallback((patch: Partial<IdePreferences>) => {
    setIdePreferences((previous) => {
      const merged: IdePreferences = { ...previous, ...patch };
      merged.editorFontSizePx = Math.max(11, Math.min(22, Math.round(merged.editorFontSizePx)));
      merged.editorLineHeightPx = Math.max(16, Math.min(38, Math.round(merged.editorLineHeightPx)));
      merged.completionDebounceMs = Math.max(
        30,
        Math.min(800, Math.round(merged.completionDebounceMs))
      );
      merged.ghostDebounceMs = Math.max(60, Math.min(1400, Math.round(merged.ghostDebounceMs)));
      merged.terminalPanelHeight = clampTerminalHeight(merged.terminalPanelHeight);
      return merged;
    });
  }, []);

  const applyKeymapOverride = useCallback((id: IdeActionId, binding: string) => {
    setKeymapOverrides((previous) => {
      const next = { ...previous, [id]: binding };
      persistKeymapOverrides(next);
      return next;
    });
  }, []);

  const resetKeymapAction = useCallback((id: IdeActionId) => {
    setKeymapOverrides((previous) => {
      if (!(id in previous)) return previous;
      const next = { ...previous };
      delete next[id];
      persistKeymapOverrides(next);
      return next;
    });
  }, []);

  const resetAllKeymap = useCallback(() => {
    setKeymapOverrides({});
    persistKeymapOverrides({});
  }, []);

  useEffect(() => {
    if (!recordingActionId) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecordingActionId(null);
        return;
      }
      if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      applyKeymapOverride(recordingActionId, bindingFromEvent(event));
      setRecordingActionId(null);
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [recordingActionId, applyKeymapOverride]);

  useEffect(() => {
    persistIdePreferences(idePreferences);
  }, [idePreferences]);

  const normalizedSettingsSearch = ideSettingsSearch.trim().toLowerCase();
  const matchesIdeSettingsSearch = useCallback(
    (...parts: string[]) => {
      if (!normalizedSettingsSearch) return true;
      return parts.join(" ").toLowerCase().includes(normalizedSettingsSearch);
    },
    [normalizedSettingsSearch]
  );
  const visibleSettingsSectionIds = useMemo(() => {
    if (!normalizedSettingsSearch) return settingsSections.map((section) => section.id);
    return settingsSections
      .filter((section) =>
        [section.label, section.description]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSettingsSearch)
      )
      .map((section) => section.id);
  }, [normalizedSettingsSearch]);

  useEffect(() => {
    if (!showIdeSettings || visibleSettingsSectionIds.length === 0) return;
    if (!visibleSettingsSectionIds.includes(ideSettingsSection)) {
      setIdeSettingsSection(visibleSettingsSectionIds[0] || "general");
    }
  }, [ideSettingsSection, showIdeSettings, visibleSettingsSectionIds]);

  return {
    keymapOverrides,
    recordingActionId,
    setRecordingActionId,
    isMacPlatform,
    showIdeSettings,
    setShowIdeSettings,
    ideSettingsSection,
    setIdeSettingsSection,
    ideSettingsSearch,
    setIdeSettingsSearch,
    idePreferences,
    setIdePreferences,
    settingsSearchRef,
    openIdeSettings,
    updateIdePreferences,
    resetKeymapAction,
    resetAllKeymap,
    normalizedSettingsSearch,
    matchesIdeSettingsSearch,
    settingsSections,
    visibleSettingsSectionIds,
  };
}
