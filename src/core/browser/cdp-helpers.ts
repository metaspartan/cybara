// CDP helpers for browser control - ported from OpenClaw cdp.ts
// These provide direct CDP access for more complete accessibility tree and DOM content

import type { Page, Frame, ElementHandle } from "puppeteer-core";

// Raw CDP accessibility node type
export type RawAXNode = {
  nodeId?: string;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  description?: { value?: string };
  childIds?: string[];
  backendDOMNodeId?: number;
};

// Formatted ARIA snapshot node
export type AriaSnapshotNode = {
  ref: string;
  role: string;
  name: string;
  value?: string;
  description?: string;
  backendDOMNodeId?: number;
  depth: number;
};

// Ref info stored for element resolution
export type RefInfo = {
  role: string;
  name?: string;
  nth?: number;
  backendDOMNodeId?: number;
};

function axValue(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const value = (v as { value?: unknown }).value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

/**
 * Format raw CDP AX nodes into a flat list with refs and depth
 */
export function formatAriaSnapshot(nodes: RawAXNode[], limit: number): AriaSnapshotNode[] {
  const byId = new Map<string, RawAXNode>();
  for (const n of nodes) {
    if (n.nodeId) byId.set(n.nodeId, n);
  }

  // Find root node
  const referenced = new Set<string>();
  for (const n of nodes) {
    for (const c of n.childIds ?? []) referenced.add(c);
  }
  const root = nodes.find((n) => n.nodeId && !referenced.has(n.nodeId)) ?? nodes[0];
  if (!root?.nodeId) return [];

  const out: AriaSnapshotNode[] = [];
  const stack: Array<{ id: string; depth: number }> = [{ id: root.nodeId, depth: 0 }];

  while (stack.length && out.length < limit) {
    const popped = stack.pop();
    if (!popped) break;
    const { id, depth } = popped;
    const n = byId.get(id);
    if (!n) continue;

    const role = axValue(n.role);
    const name = axValue(n.name);
    const value = axValue(n.value);
    const description = axValue(n.description);
    const ref = `e${out.length + 1}`;

    out.push({
      ref,
      role: role || "unknown",
      name: name || "",
      ...(value ? { value } : {}),
      ...(description ? { description } : {}),
      ...(typeof n.backendDOMNodeId === "number" ? { backendDOMNodeId: n.backendDOMNodeId } : {}),
      depth,
    });

    const children = (n.childIds ?? []).filter((c) => byId.has(c));
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child) stack.push({ id: child, depth: depth + 1 });
    }
  }

  return out;
}

/**
 * Get FULL accessibility tree via CDP Accessibility.getFullAXTree
 * This is more complete than Puppeteer's accessibility.snapshot()
 */
export async function getFullAccessibilityTree(
  page: Page,
  limit = 500
): Promise<AriaSnapshotNode[]> {
  const client = await page.createCDPSession();
  try {
    await client.send("Accessibility.enable").catch(() => {});
    const res = (await client.send("Accessibility.getFullAXTree")) as {
      nodes?: RawAXNode[];
    };
    const nodes = Array.isArray(res?.nodes) ? res.nodes : [];
    return formatAriaSnapshot(nodes, Math.max(1, Math.min(2000, limit)));
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Get accessibility tree for a specific frame (like OpenClaw frameSelector)
 */
export async function getFrameAccessibilityTree(
  page: Page,
  frameSelector: string,
  limit = 500
): Promise<AriaSnapshotNode[]> {
  // Find the frame by selector
  const frames = page.frames();
  let targetFrame: Frame | undefined;

  for (const frame of frames) {
    const name = frame.name();
    const url = frame.url();
    if (name === frameSelector || url.includes(frameSelector)) {
      targetFrame = frame;
      break;
    }
  }

  if (!targetFrame) {
    // Try to find by CSS selector on main frame
    try {
      const frameEl = await page.$(frameSelector);
      if (frameEl) {
        const cf = await frameEl.contentFrame();
        if (cf) targetFrame = cf;
      }
    } catch (error) {
      console.debug("[CDP] Failed to resolve frame selector:", error);
    }
  }

  if (!targetFrame) {
    console.log(`[CDP] Frame not found: ${frameSelector}`);
    return [];
  }

  // Get accessibility tree from frame context
  const client = await page.createCDPSession();
  try {
    await client.send("Accessibility.enable").catch(() => {});
    const res = (await client.send("Accessibility.getFullAXTree")) as {
      nodes?: RawAXNode[];
    };
    const nodes = Array.isArray(res?.nodes) ? res.nodes : [];
    return formatAriaSnapshot(nodes, Math.max(1, Math.min(2000, limit)));
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Get page text content via CDP Runtime.evaluate
 * More reliable than accessibility API for actual visible text
 */
export async function getDomText(
  page: Page,
  options: {
    format?: "html" | "text";
    maxChars?: number;
    selector?: string;
  } = {}
): Promise<string> {
  const format = options.format ?? "text";
  const maxChars = Math.max(0, Math.min(5_000_000, Math.floor(options.maxChars ?? 200_000)));
  const selector = options.selector ?? "";

  const client = await page.createCDPSession();
  try {
    await client.send("Runtime.enable").catch(() => {});

    const expression = `(() => {
      const fmt = ${JSON.stringify(format)};
      const max = ${JSON.stringify(maxChars)};
      const sel = ${JSON.stringify(selector)};
      const pick = sel ? document.querySelector(sel) : null;
      let out = "";
      if (fmt === "text") {
        const el = pick || document.body || document.documentElement;
        try { out = String(el && el.innerText ? el.innerText : ""); } catch { out = ""; }
      } else {
        const el = pick || document.documentElement;
        try { out = String(el && el.outerHTML ? el.outerHTML : ""); } catch { out = ""; }
      }
      if (max && out.length > max) out = out.slice(0, max) + "\\n<!-- ...truncated... -->";
      return out;
    })()`;

    const result = (await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })) as { result?: { value?: unknown } };

    const textValue = result?.result?.value ?? "";
    return typeof textValue === "string" ? textValue : String(textValue);
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Query DOM elements by selector via CDP
 */
export async function querySelectorAll(
  page: Page,
  selector: string,
  options: {
    limit?: number;
    maxTextChars?: number;
  } = {}
): Promise<
  Array<{
    index: number;
    tag: string;
    text?: string;
    value?: string;
    href?: string;
  }>
> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const maxText = Math.max(0, Math.min(5000, options.maxTextChars ?? 500));

  const client = await page.createCDPSession();
  try {
    await client.send("Runtime.enable").catch(() => {});

    const expression = `(() => {
      const sel = ${JSON.stringify(selector)};
      const lim = ${JSON.stringify(limit)};
      const maxText = ${JSON.stringify(maxText)};
      const els = Array.from(document.querySelectorAll(sel)).slice(0, lim);
      return els.map((el, i) => {
        const tag = (el.tagName || "").toLowerCase();
        let text = "";
        try { text = String(el.innerText || "").trim(); } catch {}
        if (maxText && text.length > maxText) text = text.slice(0, maxText) + "...";
        const value = (el.value !== undefined && el.value !== null) ? String(el.value).slice(0, 500) : undefined;
        const href = (el.href !== undefined && el.href !== null) ? String(el.href) : undefined;
        return {
          index: i + 1,
          tag,
          ...(text ? { text } : {}),
          ...(value ? { value } : {}),
          ...(href ? { href } : {}),
        };
      });
    })()`;

    const result = (await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: unknown } };

    const matches = result?.result?.value;
    return Array.isArray(matches) ? matches : [];
  } finally {
    await client.detach().catch(() => {});
  }
}

/**
 * Resolve a ref (e1, e2, etc.) to an element handle using role+name
 * This is the Puppeteer equivalent of OpenClaw's refLocator with getByRole
 */
export async function resolveRefToElement(
  page: Page,
  refInfo: RefInfo
): Promise<ElementHandle | null> {
  const { role, name, nth } = refInfo;

  // Build a selector based on role and name
  // ARIA roles map to HTML elements and role attributes
  const roleSelectors: Record<string, string> = {
    button: 'button, [role="button"], input[type="button"], input[type="submit"]',
    link: 'a[href], [role="link"]',
    textbox:
      'input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input:not([type]), textarea, [role="textbox"], [contenteditable="true"]',
    checkbox: 'input[type="checkbox"], [role="checkbox"]',
    radio: 'input[type="radio"], [role="radio"]',
    combobox: 'select, [role="combobox"], [role="listbox"]',
    option: 'option, [role="option"]',
    heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
    list: 'ul, ol, [role="list"]',
    listitem: 'li, [role="listitem"]',
    img: 'img, [role="img"]',
    navigation: 'nav, [role="navigation"]',
    main: 'main, [role="main"]',
    region: '[role="region"], section',
    dialog: 'dialog, [role="dialog"]',
    menu: '[role="menu"]',
    menuitem: '[role="menuitem"]',
    tab: '[role="tab"]',
    tabpanel: '[role="tabpanel"]',
    table: 'table, [role="table"]',
    row: 'tr, [role="row"]',
    cell: 'td, th, [role="cell"], [role="gridcell"]',
  };

  const selector = roleSelectors[role.toLowerCase()] || `[role="${role}"]`;

  try {
    const elements = await page.$$(selector);

    if (name) {
      // Filter by name (text content, aria-label, title, placeholder)
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (!el) continue;

        const elProps = (await el.evaluate(`
                    (function(node) {
                        return {
                            text: (node.innerText || "").trim(),
                            ariaLabel: node.getAttribute("aria-label") || "",
                            title: node.getAttribute("title") || "",
                            placeholder: node.placeholder || "",
                            value: node.value || ""
                        };
                    })(arguments[0])
                `)) as {
          text: string;
          ariaLabel: string;
          title: string;
          placeholder: string;
          value: string;
        };

        const matchesName =
          elProps.text === name ||
          elProps.ariaLabel === name ||
          elProps.title === name ||
          elProps.placeholder === name ||
          elProps.text.includes(name) ||
          elProps.ariaLabel.includes(name);

        if (matchesName) {
          // If nth is specified, count matches
          if (nth !== undefined && nth > 0) {
            let matchCount = 0;
            for (let j = 0; j <= i; j++) {
              const checkEl = elements[j];
              if (!checkEl) continue;
              const checkProps = (await checkEl.evaluate(`
                                (function(node) {
                                    return {
                                        text: (node.innerText || "").trim(),
                                        ariaLabel: node.getAttribute("aria-label") || ""
                                    };
                                })(arguments[0])
                            `)) as { text: string; ariaLabel: string };
              if (
                checkProps.text === name ||
                checkProps.ariaLabel === name ||
                checkProps.text.includes(name) ||
                checkProps.ariaLabel.includes(name)
              ) {
                matchCount++;
              }
            }
            if (matchCount - 1 === nth) return el;
          } else {
            return el;
          }
        }
      }
    }

    // If no name match or no name specified, return nth element or first
    const index = nth ?? 0;
    return elements[index] ?? null;
  } catch (err) {
    console.log(`[CDP] resolveRefToElement failed for role=${role} name=${name}:`, err);
    return null;
  }
}

/**
 * Get bounding boxes for refs (used for labeled screenshots)
 */
export async function getRefBoundingBoxes(
  page: Page,
  refs: Record<string, RefInfo>
): Promise<Array<{ ref: string; x: number; y: number; w: number; h: number }>> {
  const boxes: Array<{ ref: string; x: number; y: number; w: number; h: number }> = [];

  // Get viewport info
  const viewport = (await page.evaluate(`
        (function() {
            return {
                scrollX: window.scrollX || 0,
                scrollY: window.scrollY || 0,
                width: window.innerWidth || 0,
                height: window.innerHeight || 0
            };
        })()
    `)) as { scrollX: number; scrollY: number; width: number; height: number };

  for (const [ref, info] of Object.entries(refs)) {
    try {
      const el = await resolveRefToElement(page, info);
      if (!el) continue;

      const box = await el.boundingBox();
      if (!box) continue;

      // Check if visible in viewport
      const x0 = box.x;
      const y0 = box.y;
      const x1 = box.x + box.width;
      const y1 = box.y + box.height;
      const vx0 = viewport.scrollX;
      const vy0 = viewport.scrollY;
      const vx1 = viewport.scrollX + viewport.width;
      const vy1 = viewport.scrollY + viewport.height;

      if (x1 < vx0 || x0 > vx1 || y1 < vy0 || y0 > vy1) continue;

      boxes.push({
        ref,
        x: x0 - viewport.scrollX,
        y: y0 - viewport.scrollY,
        w: Math.max(1, box.width),
        h: Math.max(1, box.height),
      });
    } catch {
      continue;
    }
  }

  return boxes;
}

/**
 * Take screenshot with ref labels overlaid (like OpenClaw screenshotWithLabels)
 */
export async function screenshotWithLabels(
  page: Page,
  refs: Record<string, RefInfo>,
  options: {
    maxLabels?: number;
    type?: "png" | "jpeg";
  } = {}
): Promise<{ buffer: Buffer; labels: number; skipped: number }> {
  const maxLabels = options.maxLabels ?? 150;
  const type = options.type ?? "png";

  const boxes = await getRefBoundingBoxes(page, refs);
  const visibleBoxes = boxes.slice(0, maxLabels);
  const skipped = boxes.length - visibleBoxes.length;

  try {
    // Inject label overlay
    if (visibleBoxes.length > 0) {
      const labelsJson = JSON.stringify(visibleBoxes);
      await page.evaluate(`
                (function() {
                    var labels = ${labelsJson};
                    var existing = document.querySelectorAll("[data-cybara-labels]");
                    existing.forEach(function(el) { el.remove(); });
                    
                    var root = document.createElement("div");
                    root.setAttribute("data-cybara-labels", "1");
                    root.style.position = "fixed";
                    root.style.left = "0";
                    root.style.top = "0";
                    root.style.zIndex = "2147483647";
                    root.style.pointerEvents = "none";
                    root.style.fontFamily = '"SF Mono",Menlo,Monaco,Consolas,monospace';
                    
                    function clamp(value, min, max) {
                        return Math.min(max, Math.max(min, value));
                    }
                    
                    for (var i = 0; i < labels.length; i++) {
                        var label = labels[i];
                        var box = document.createElement("div");
                        box.setAttribute("data-cybara-labels", "1");
                        box.style.position = "absolute";
                        box.style.left = label.x + "px";
                        box.style.top = label.y + "px";
                        box.style.width = label.w + "px";
                        box.style.height = label.h + "px";
                        box.style.border = "2px solid #F4B400";
                        box.style.boxSizing = "border-box";
                        
                        var tag = document.createElement("div");
                        tag.setAttribute("data-cybara-labels", "1");
                        tag.textContent = label.ref;
                        tag.style.position = "absolute";
                        tag.style.left = label.x + "px";
                        tag.style.top = clamp(label.y - 18, 0, 20000) + "px";
                        tag.style.background = "#F4B400";
                        tag.style.color = "#1a1a1a";
                        tag.style.fontSize = "12px";
                        tag.style.lineHeight = "14px";
                        tag.style.padding = "1px 4px";
                        tag.style.borderRadius = "3px";
                        tag.style.boxShadow = "0 1px 2px rgba(0,0,0,0.35)";
                        tag.style.whiteSpace = "nowrap";
                        
                        root.appendChild(box);
                        root.appendChild(tag);
                    }
                    
                    document.documentElement.appendChild(root);
                })()
            `);
    }

    // Take screenshot
    const buffer = (await page.screenshot({ type, encoding: "binary" })) as Buffer;

    return { buffer, labels: visibleBoxes.length, skipped };
  } finally {
    // Clean up labels
    await page
      .evaluate(
        `
            (function() {
                var existing = document.querySelectorAll("[data-cybara-labels]");
                existing.forEach(function(el) { el.remove(); });
            })()
        `
      )
      .catch(() => {});
  }
}

/**
 * Scroll element into view
 */
export async function scrollIntoView(page: Page, refInfo: RefInfo): Promise<boolean> {
  const el = await resolveRefToElement(page, refInfo);
  if (!el) return false;

  await el.evaluate(`
        (function(node) {
            node.scrollIntoView({ behavior: "smooth", block: "center" });
        })(arguments[0])
    `);
  return true;
}

/**
 * Hover over element
 */
export async function hoverElement(page: Page, refInfo: RefInfo): Promise<boolean> {
  const el = await resolveRefToElement(page, refInfo);
  if (!el) return false;

  await el.hover();
  return true;
}

/**
 * Select option in dropdown
 */
export async function selectOption(
  page: Page,
  refInfo: RefInfo,
  values: string[]
): Promise<boolean> {
  const el = await resolveRefToElement(page, refInfo);
  if (!el) return false;

  await el.select(...values);
  return true;
}

/**
 * Wait for various conditions (like OpenClaw waitFor)
 */
export async function waitFor(
  page: Page,
  options: {
    timeMs?: number;
    text?: string;
    textGone?: string;
    selector?: string;
    url?: string;
    networkIdle?: boolean;
    timeoutMs?: number;
  }
): Promise<void> {
  const timeout = Math.max(500, Math.min(60_000, options.timeoutMs ?? 20_000));

  if (typeof options.timeMs === "number" && options.timeMs > 0) {
    await new Promise((r) => setTimeout(r, options.timeMs));
  }

  if (options.text) {
    const escapedText = JSON.stringify(options.text);
    await page.waitForFunction(
      `document.body && document.body.innerText && document.body.innerText.includes(${escapedText})`,
      { timeout }
    );
  }

  if (options.textGone) {
    const escapedText = JSON.stringify(options.textGone);
    await page.waitForFunction(
      `!(document.body && document.body.innerText && document.body.innerText.includes(${escapedText}))`,
      { timeout }
    );
  }

  if (options.selector) {
    await page.waitForSelector(options.selector, { timeout, visible: true });
  }

  if (options.url) {
    const escapedUrl = JSON.stringify(options.url);
    await page.waitForFunction(`window.location.href.includes(${escapedUrl})`, { timeout });
  }

  if (options.networkIdle) {
    await page.waitForNetworkIdle({ timeout, idleTime: 500 });
  }
}

/**
 * Fill form field (clear first, then type)
 */
export async function fillField(
  page: Page,
  refInfo: RefInfo,
  text: string,
  options: { submit?: boolean; slowly?: boolean } = {}
): Promise<boolean> {
  const el = await resolveRefToElement(page, refInfo);
  if (!el) return false;

  // Clear existing content
  await el.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");

  if (options.slowly) {
    // Type character by character
    await el.type(text, { delay: 75 });
  } else {
    // Fast fill via evaluate
    const escapedText = JSON.stringify(text);
    await el.evaluate(`
            (function(node) {
                node.value = ${escapedText};
                node.dispatchEvent(new Event("input", { bubbles: true }));
                node.dispatchEvent(new Event("change", { bubbles: true }));
            })(arguments[0])
        `);
  }

  if (options.submit) {
    await page.keyboard.press("Enter");
  }

  return true;
}
