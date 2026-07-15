import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SIDEBAR_NAVIGATION_LAYOUT,
  parseSidebarNavigationLayout,
  SIDEBAR_NAVIGATION_LAYOUT_EVENT,
  SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY,
  type SidebarNavigationLayout,
} from "@/lib/sidebarNavigation";

function readSidebarNavigationLayout(): SidebarNavigationLayout {
  return parseSidebarNavigationLayout(localStorage.getItem(SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY));
}

export function useSidebarNavigationLayout(): {
  layout: SidebarNavigationLayout;
  setLayout: (layout: SidebarNavigationLayout) => void;
  resetLayout: () => void;
} {
  const [layout, setLayoutState] = useState<SidebarNavigationLayout>(readSidebarNavigationLayout);

  useEffect(() => {
    const refresh = () => setLayoutState(readSidebarNavigationLayout());
    window.addEventListener("storage", refresh);
    window.addEventListener(SIDEBAR_NAVIGATION_LAYOUT_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(SIDEBAR_NAVIGATION_LAYOUT_EVENT, refresh);
    };
  }, []);

  const setLayout = useCallback((nextLayout: SidebarNavigationLayout) => {
    const normalized = parseSidebarNavigationLayout(JSON.stringify(nextLayout));
    localStorage.setItem(SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY, JSON.stringify(normalized));
    setLayoutState(normalized);
    window.dispatchEvent(new Event(SIDEBAR_NAVIGATION_LAYOUT_EVENT));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout({
      primary: [...DEFAULT_SIDEBAR_NAVIGATION_LAYOUT.primary],
      more: [...DEFAULT_SIDEBAR_NAVIGATION_LAYOUT.more],
    });
  }, [setLayout]);

  return { layout, setLayout, resetLayout };
}
