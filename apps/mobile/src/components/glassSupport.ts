import { useEffect, useState } from "react";

type GlassModule = typeof import("expo-glass-effect");
type GlassComponent = GlassModule["GlassView"];
type GlassContainerComponent = GlassModule["GlassContainer"];

type ResolvedGlass = {
  GlassView: GlassComponent | null;
  GlassContainer: GlassContainerComponent | null;
};

// expo-glass-effect's iOS entry calls requireNativeViewManager() at module
// scope, which throws on a build lacking the native module (a dev client not yet
// rebuilt, or iOS < 26). Load it through a guarded dynamic import so the JS
// bundle never crashes and we fall back to a blurred surface until real Liquid
// Glass is available. Shared by LiquidGlass, GlassPanel, and GlassGroup so every
// glass surface uses the genuine iOS 26 material, not just a couple.
let glassProbe: Promise<ResolvedGlass> | null = null;
let glassResolved: ResolvedGlass | null = null;

export function loadNativeGlass(): Promise<ResolvedGlass> {
  if (!glassProbe) {
    glassProbe = (async () => {
      try {
        const mod = await import("expo-glass-effect");
        if (!mod.isLiquidGlassAvailable()) {
          return { GlassView: null, GlassContainer: null };
        }
        return { GlassView: mod.GlassView, GlassContainer: mod.GlassContainer };
      } catch {
        return { GlassView: null, GlassContainer: null };
      }
    })().then((result) => {
      glassResolved = result;
      return result;
    });
  }
  return glassProbe;
}

function useResolvedGlass(): ResolvedGlass | null {
  const [resolved, setResolved] = useState(glassResolved);
  useEffect(() => {
    if (glassResolved) return;
    let active = true;
    loadNativeGlass().then((result) => {
      if (active) setResolved(result);
    });
    return () => {
      active = false;
    };
  }, []);
  return resolved;
}

/** React hook: resolves to the native GlassView when Liquid Glass is available. */
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
