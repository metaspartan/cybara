// OpenClaw-compatible Playwright snapshot functions
// Port of /tmp/openclaw/src/browser/pw-tools-core.snapshot.ts

import type { Page, Locator, FrameLocator } from "playwright-core";
import {
  buildRoleSnapshotFromAiSnapshot,
  buildRoleSnapshotFromAriaSnapshot,
  getRoleSnapshotStats,
  type RoleSnapshotOptions,
  type RoleRefMap,
} from "./pw-role-snapshot";

// Type for Playwright's _snapshotForAI (private API in 1.48+)
export type WithSnapshotForAI = {
  _snapshotForAI?: (options?: {
    timeout?: number;
    track?: string;
  }) => Promise<{ full: string; incremental?: string }>;
};

// Page state for tracking refs per page
type PageRoleRefs = {
  refs: RoleRefMap;
  mode: "role" | "aria";
  frameSelector?: string;
};

const pageRoleRefs = new WeakMap<Page, PageRoleRefs>();

/**
 * Store role refs for a page (for later resolution in act)
 */
export function storeRoleRefsForPage(
  page: Page,
  refs: RoleRefMap,
  mode: "role" | "aria",
  frameSelector?: string
): void {
  pageRoleRefs.set(page, { refs, mode, frameSelector });
}

/**
 * Get stored role refs for a page
 */
export function getRoleRefsForPage(page: Page): PageRoleRefs | undefined {
  return pageRoleRefs.get(page);
}

/**
 * Get aria snapshot using Playwright's ariaSnapshot() on a locator
 */
export async function snapshotAriaViaPlaywright(
  page: Page,
  opts: {
    selector?: string;
    frameSelector?: string;
    options?: RoleSnapshotOptions;
  } = {}
): Promise<{ snapshot: string; refs: RoleRefMap; stats: ReturnType<typeof getRoleSnapshotStats> }> {
  const frameSelector = opts.frameSelector?.trim() || "";
  const selector = opts.selector?.trim() || "";

  // Build the locator
  let locator: Locator | ReturnType<FrameLocator["locator"]>;
  if (frameSelector) {
    const frame = page.frameLocator(frameSelector);
    locator = selector ? frame.locator(selector) : frame.locator(":root");
  } else {
    locator = selector ? page.locator(selector) : page.locator(":root");
  }

  // Get aria snapshot
  const ariaSnapshot = await locator.ariaSnapshot();
  const built = buildRoleSnapshotFromAriaSnapshot(String(ariaSnapshot ?? ""), opts.options);

  // Store refs for this page
  storeRoleRefsForPage(page, built.refs, "role", frameSelector || undefined);

  return {
    snapshot: built.snapshot,
    refs: built.refs,
    stats: getRoleSnapshotStats(built.snapshot, built.refs),
  };
}

/**
 * Get AI snapshot using Playwright's _snapshotForAI() (Playwright 1.48+)
 */
export async function snapshotAiViaPlaywright(
  page: Page,
  opts: {
    timeoutMs?: number;
    maxChars?: number;
  } = {}
): Promise<{ snapshot: string; truncated?: boolean; refs: RoleRefMap }> {
  const maybe = page as unknown as WithSnapshotForAI;
  if (!maybe._snapshotForAI) {
    throw new Error(
      "Playwright _snapshotForAI is not available. Upgrade playwright-core to 1.48+."
    );
  }

  const result = await maybe._snapshotForAI({
    timeout: Math.max(500, Math.min(60_000, Math.floor(opts.timeoutMs ?? 5000))),
    track: "response",
  });

  let snapshot = String(result?.full ?? "");
  const maxChars = opts.maxChars;
  const limit =
    typeof maxChars === "number" && Number.isFinite(maxChars) && maxChars > 0
      ? Math.floor(maxChars)
      : undefined;

  let truncated = false;
  if (limit && snapshot.length > limit) {
    snapshot = `${snapshot.slice(0, limit)}\n\n[...TRUNCATED - page too large]`;
    truncated = true;
  }

  const built = buildRoleSnapshotFromAiSnapshot(snapshot);
  storeRoleRefsForPage(page, built.refs, "aria");

  return truncated ? { snapshot, truncated, refs: built.refs } : { snapshot, refs: built.refs };
}

/**
 * Get role snapshot with options (interactive, compact, maxDepth)
 * Falls back to ariaSnapshot() if _snapshotForAI is not available
 */
export async function snapshotRoleViaPlaywright(
  page: Page,
  opts: {
    selector?: string;
    frameSelector?: string;
    refsMode?: "role" | "aria";
    options?: RoleSnapshotOptions;
  } = {}
): Promise<{
  snapshot: string;
  refs: RoleRefMap;
  stats: ReturnType<typeof getRoleSnapshotStats>;
}> {
  // If refsMode is "aria", use _snapshotForAI
  if (opts.refsMode === "aria") {
    if (opts.selector?.trim() || opts.frameSelector?.trim()) {
      throw new Error("refs=aria does not support selector/frame snapshots yet.");
    }
    const maybe = page as unknown as WithSnapshotForAI;
    if (!maybe._snapshotForAI) {
      throw new Error("refs=aria requires Playwright _snapshotForAI support.");
    }
    const result = await maybe._snapshotForAI({
      timeout: 5000,
      track: "response",
    });
    const built = buildRoleSnapshotFromAiSnapshot(String(result?.full ?? ""), opts.options);
    storeRoleRefsForPage(page, built.refs, "aria");
    return {
      snapshot: built.snapshot,
      refs: built.refs,
      stats: getRoleSnapshotStats(built.snapshot, built.refs),
    };
  }

  // Otherwise use ariaSnapshot()
  return snapshotAriaViaPlaywright(page, opts);
}

/**
 * Resolve a ref (e.g. "e12") to a Playwright locator
 * This is the key function for acting on refs from snapshots
 */
export function refLocator(page: Page, ref: string): Locator {
  const normalized = ref.startsWith("@")
    ? ref.slice(1)
    : ref.startsWith("ref=")
      ? ref.slice(4)
      : ref;

  if (/^e\d+$/.test(normalized)) {
    const state = pageRoleRefs.get(page);

    // For aria mode, use aria-ref locator
    if (state?.mode === "aria") {
      const scope = state.frameSelector ? page.frameLocator(state.frameSelector) : page;
      return scope.locator(`aria-ref=${normalized}`);
    }

    // For role mode, use getByRole
    const info = state?.refs?.[normalized];
    if (!info) {
      throw new Error(
        `Unknown ref "${normalized}". Run a new snapshot and use a ref from that snapshot.`
      );
    }

    const scope = state?.frameSelector ? page.frameLocator(state.frameSelector) : page;

    const locator = info.name
      ? (scope as any).getByRole(info.role, { name: info.name, exact: true })
      : (scope as any).getByRole(info.role);

    return info.nth !== undefined ? locator.nth(info.nth) : locator;
  }

  // Direct aria-ref
  return page.locator(`aria-ref=${normalized}`);
}

/**
 * Check if Playwright has _snapshotForAI available
 */
export function hasAiSnapshotSupport(page: Page): boolean {
  const maybe = page as unknown as WithSnapshotForAI;
  return typeof maybe._snapshotForAI === "function";
}

/**
 * Navigate to a URL
 */
export async function navigateViaPlaywright(
  page: Page,
  opts: {
    url: string;
    timeoutMs?: number;
  }
): Promise<{ url: string }> {
  const url = String(opts.url ?? "").trim();
  if (!url) throw new Error("url is required");
  await page.goto(url, {
    timeout: Math.max(1000, Math.min(120_000, opts.timeoutMs ?? 20_000)),
  });
  return { url: page.url() };
}
