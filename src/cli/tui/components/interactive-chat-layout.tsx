import React from "react";
import {
  resolveTerminalChatInspector,
  useTerminalLayout,
  type TerminalChatInspectorLayout,
  type TerminalLayout,
} from "../terminal";
import {
  resolveTuiColorScheme,
  tuiChatPalette,
  type TuiColorScheme,
  type TuiSurfacePalette,
} from "../theme";

interface InteractiveChatLayout {
  colorScheme: TuiColorScheme;
  dismissTransientEnvironmentPanel: () => void;
  environmentPanelVisible: boolean;
  environmentSidebarVisible: boolean;
  environmentStackedVisible: boolean;
  inspector: TerminalChatInspectorLayout;
  layout: TerminalLayout;
  palette: TuiSurfacePalette;
  toggleEnvironmentPanel: () => void;
  transcriptColumns: number;
}

export function useInteractiveChatLayout(): InteractiveChatLayout {
  const layout = useTerminalLayout();
  const colorScheme = resolveTuiColorScheme(process.env);
  const palette = tuiChatPalette(colorScheme);
  const inspector = resolveTerminalChatInspector(layout.columns);
  const [environmentPanelMode, setEnvironmentPanelMode] = React.useState<
    "auto" | "shown" | "hidden"
  >("auto");
  const environmentPanelVisible =
    environmentPanelMode === "shown" || (environmentPanelMode === "auto" && inspector.sidebar);
  const environmentSidebarVisible = environmentPanelVisible && inspector.sidebar;
  const environmentStackedVisible = environmentPanelVisible && !inspector.sidebar;
  const transcriptColumns = environmentSidebarVisible ? inspector.contentColumns : layout.columns;
  const toggleEnvironmentPanel = React.useCallback(() => {
    setEnvironmentPanelMode((current) => {
      const visible = current === "shown" || (current === "auto" && inspector.sidebar);
      return visible ? "hidden" : "shown";
    });
  }, [inspector.sidebar]);
  const dismissTransientEnvironmentPanel = React.useCallback(() => {
    setEnvironmentPanelMode((current) => (current === "shown" ? "hidden" : current));
  }, []);
  return {
    colorScheme,
    dismissTransientEnvironmentPanel,
    environmentPanelVisible,
    environmentSidebarVisible,
    environmentStackedVisible,
    inspector,
    layout,
    palette,
    toggleEnvironmentPanel,
    transcriptColumns,
  };
}
