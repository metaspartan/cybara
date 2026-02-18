import type { Page, Locator, FrameLocator } from "playwright-core";
import {
  buildRoleSnapshotFromAiSnapshot,
  buildRoleSnapshotFromAriaSnapshot,
  getRoleSnapshotStats,
  type RoleSnapshotOptions,
  type RoleRefMap,
} from "./pw-role-snapshot";

export type WithSnapshotForAI = {
  _snapshotForAI?: (options?: {
    timeout?: number;
    track?: string;
  }) => Promise<{ full: string; incremental?: string }>;
};

type PageRoleRefs = {
  refs: RoleRefMap;
  mode: "role" | "aria";
  frameSelector?: string;
};

const pageRoleRefs = new WeakMap<Page, PageRoleRefs>();

export function storeRoleRefsForPage(
  page: Page,
  refs: RoleRefMap,
  mode: "role" | "aria",
  frameSelector?: string
): void {
  pageRoleRefs.set(page, { refs, mode, frameSelector });
}

export function getRoleRefsForPage(page: Page): PageRoleRefs | undefined {
  return pageRoleRefs.get(page);
}

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

  let locator: Locator | ReturnType<FrameLocator["locator"]>;
  if (frameSelector) {
    const frame = page.frameLocator(frameSelector);
    locator = selector ? frame.locator(selector) : frame.locator(":root");
  } else {
    locator = selector ? page.locator(selector) : page.locator(":root");
  }

  const ariaSnapshot = await locator.ariaSnapshot();
  const built = buildRoleSnapshotFromAriaSnapshot(String(ariaSnapshot ?? ""), opts.options);

  storeRoleRefsForPage(page, built.refs, "role", frameSelector || undefined);

  return {
    snapshot: built.snapshot,
    refs: built.refs,
    stats: getRoleSnapshotStats(built.snapshot, built.refs),
  };
}

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

  return snapshotAriaViaPlaywright(page, opts);
}

export function refLocator(page: Page, ref: string): Locator {
  const normalized = ref.startsWith("@")
    ? ref.slice(1)
    : ref.startsWith("ref=")
      ? ref.slice(4)
      : ref;

  if (/^e\d+$/.test(normalized)) {
    const state = pageRoleRefs.get(page);

    if (state?.mode === "aria") {
      const scope = state.frameSelector ? page.frameLocator(state.frameSelector) : page;
      return scope.locator(`aria-ref=${normalized}`);
    }

    const info = state?.refs?.[normalized];
    if (!info) {
      throw new Error(
        `Unknown ref "${normalized}". Run a new snapshot and use a ref from that snapshot.`
      );
    }

    const scope = state?.frameSelector ? page.frameLocator(state.frameSelector) : page;

    const roleScope = scope as { getByRole: Page["getByRole"] };
    const role = info.role as Parameters<Page["getByRole"]>[0];
    const locator = info.name
      ? roleScope.getByRole(role, { name: info.name, exact: true })
      : roleScope.getByRole(role);

    return info.nth !== undefined ? locator.nth(info.nth) : locator;
  }

  return page.locator(`aria-ref=${normalized}`);
}

export function hasAiSnapshotSupport(page: Page): boolean {
  const maybe = page as unknown as WithSnapshotForAI;
  return typeof maybe._snapshotForAI === "function";
}

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
