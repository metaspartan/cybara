import {
  GlassContainer,
  GlassView,
  Platform,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from "../lib/expoNativeModules";

type GlassComponent = typeof GlassView;
type GlassContainerComponent = typeof GlassContainer;

type ResolvedGlass = {
  GlassView: GlassComponent | null;
  GlassContainer: GlassContainerComponent | null;
};

let glassResolved: ResolvedGlass | undefined;

export function canUseNativeGlassRuntime(
  platform: string = Platform.OS,
  version: string | number = Platform.Version
): boolean {
  if (platform !== "ios") return false;
  const major = Number.parseInt(String(version), 10);
  return Number.isFinite(major) && major >= 26;
}

function resolveNativeGlass(): ResolvedGlass {
  if (glassResolved) return glassResolved;
  try {
    glassResolved =
      canUseNativeGlassRuntime() && isGlassEffectAPIAvailable() && isLiquidGlassAvailable()
        ? { GlassView, GlassContainer }
        : { GlassView: null, GlassContainer: null };
  } catch {
    glassResolved = { GlassView: null, GlassContainer: null };
  }
  return glassResolved;
}

export function loadNativeGlass(): Promise<ResolvedGlass> {
  return Promise.resolve(resolveNativeGlass());
}

function useResolvedGlass(): ResolvedGlass | null {
  return resolveNativeGlass();
}
export function useNativeGlassView(): GlassComponent | null {
  return useResolvedGlass()?.GlassView ?? null;
}

/**
 * React hook: resolves to the native GlassContainer when available. Apple
 * recommends grouping adjacent glass elements in a container on iOS 26 so they
 * blend/merge correctly (via its `spacing` prop) instead of layering as
 * independent panes.
 */
export function useNativeGlassContainer(): GlassContainerComponent | null {
  return useResolvedGlass()?.GlassContainer ?? null;
}
