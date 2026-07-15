export const SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY = "cybara.sidebarNavigationLayout";
export const SIDEBAR_NAVIGATION_LAYOUT_EVENT = "cybara:sidebar-navigation-layout";

export type SidebarDestinationId =
  | "dashboard"
  | "ide"
  | "usage"
  | "voice"
  | "lab"
  | "terminal"
  | "lsp"
  | "sessions"
  | "journey"
  | "wallet"
  | "artifacts"
  | "metrics"
  | "tasks";

export type SidebarPrimaryItemId = SidebarDestinationId | "more";
export type SidebarNavigationZone = "primary" | "more";

export interface SidebarNavigationLayout {
  primary: SidebarPrimaryItemId[];
  more: SidebarDestinationId[];
}

const SIDEBAR_DESTINATION_IDS: SidebarDestinationId[] = [
  "dashboard",
  "ide",
  "usage",
  "voice",
  "lab",
  "terminal",
  "lsp",
  "sessions",
  "journey",
  "wallet",
  "artifacts",
  "metrics",
  "tasks",
];

const SIDEBAR_DESTINATION_ID_SET = new Set<SidebarDestinationId>(SIDEBAR_DESTINATION_IDS);

export const DEFAULT_SIDEBAR_NAVIGATION_LAYOUT: SidebarNavigationLayout = {
  primary: ["dashboard", "usage", "more"],
  more: [
    "ide",
    "voice",
    "lab",
    "terminal",
    "lsp",
    "sessions",
    "journey",
    "wallet",
    "artifacts",
    "metrics",
    "tasks",
  ],
};

const PREVIOUS_DEFAULT_SIDEBAR_NAVIGATION_LAYOUT: SidebarNavigationLayout = {
  primary: ["dashboard", "ide", "usage", "more"],
  more: [
    "voice",
    "lab",
    "terminal",
    "lsp",
    "sessions",
    "journey",
    "wallet",
    "artifacts",
    "metrics",
    "tasks",
  ],
};

function cloneDefaultLayout(): SidebarNavigationLayout {
  return {
    primary: [...DEFAULT_SIDEBAR_NAVIGATION_LAYOUT.primary],
    more: [...DEFAULT_SIDEBAR_NAVIGATION_LAYOUT.more],
  };
}

function isDestinationId(value: unknown): value is SidebarDestinationId {
  return typeof value === "string" && SIDEBAR_DESTINATION_ID_SET.has(value as SidebarDestinationId);
}

function layoutsMatch(left: SidebarNavigationLayout, right: SidebarNavigationLayout): boolean {
  return (
    left.primary.length === right.primary.length &&
    left.more.length === right.more.length &&
    left.primary.every((item, index) => item === right.primary[index]) &&
    left.more.every((item, index) => item === right.more[index])
  );
}

export function parseSidebarNavigationLayout(value: string | null): SidebarNavigationLayout {
  if (!value) return cloneDefaultLayout();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return cloneDefaultLayout();
    const candidate = parsed as { primary?: unknown; more?: unknown };
    if (!Array.isArray(candidate.primary) || !Array.isArray(candidate.more)) {
      return cloneDefaultLayout();
    }
    const primary = candidate.primary.filter(
      (item): item is SidebarPrimaryItemId => item === "more" || isDestinationId(item)
    );
    const more = candidate.more.filter(isDestinationId);
    const combinedDestinations = [...primary.filter(isDestinationId), ...more];
    const valid =
      primary.length === candidate.primary.length &&
      more.length === candidate.more.length &&
      primary.filter((item) => item === "more").length === 1 &&
      combinedDestinations.length === SIDEBAR_DESTINATION_IDS.length &&
      new Set(combinedDestinations).size === SIDEBAR_DESTINATION_IDS.length;
    if (!valid) return cloneDefaultLayout();
    const layout = { primary, more };
    return layoutsMatch(layout, PREVIOUS_DEFAULT_SIDEBAR_NAVIGATION_LAYOUT)
      ? cloneDefaultLayout()
      : layout;
  } catch {
    return cloneDefaultLayout();
  }
}

export function moveSidebarNavigationItem(
  layout: SidebarNavigationLayout,
  source: SidebarPrimaryItemId,
  destinationZone: SidebarNavigationZone,
  target?: SidebarPrimaryItemId
): SidebarNavigationLayout {
  if (source === "more" && destinationZone === "more") {
    return { primary: [...layout.primary], more: [...layout.more] };
  }
  const primary = layout.primary.filter((item) => item !== source);
  const more = layout.more.filter((item) => item !== source);
  if (destinationZone === "primary") {
    const targetIndex = target ? primary.indexOf(target) : -1;
    primary.splice(targetIndex >= 0 ? targetIndex : primary.length, 0, source);
    return { primary, more };
  }
  if (source === "more") return { primary, more };
  const targetIndex = target && target !== "more" ? more.indexOf(target) : -1;
  more.splice(targetIndex >= 0 ? targetIndex : more.length, 0, source);
  return { primary, more };
}
