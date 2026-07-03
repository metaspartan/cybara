import { useEffect, useState } from "react";

type GlassModule = typeof import("expo-glass-effect");
type GlassComponent = GlassModule["GlassView"];

// expo-glass-effect's iOS entry calls requireNativeViewManager() at module
// scope, which throws on a build lacking the native module (a dev client not yet
// rebuilt, or iOS < 26). Load it through a guarded dynamic import so the JS
// bundle never crashes and we fall back to a blurred surface until real Liquid
// Glass is available. Shared by LiquidGlass and GlassPanel so every glass
// surface uses the genuine iOS 26 material, not just a couple.
let glassProbe: Promise<{ GlassView: GlassComponent | null }> | null = null;
let glassResolved: { GlassView: GlassComponent | null } | null = null;

export function loadNativeGlass(): Promise<{ GlassView: GlassComponent | null }> {
  if (!glassProbe) {
    glassProbe = (async () => {
      try {
        const mod = await import("expo-glass-effect");
        return { GlassView: mod.isLiquidGlassAvailable() ? mod.GlassView : null };
      } catch {
        return { GlassView: null };
      }
    })().then((result) => {
      glassResolved = result;
      return result;
    });
  }
  return glassProbe;
}

/** React hook: resolves to the native GlassView when Liquid Glass is available. */
export function useNativeGlassView(): GlassComponent | null {
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
  return resolved?.GlassView ?? null;
}
