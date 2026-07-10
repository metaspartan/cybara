import puppeteer, {
  type Browser as PuppeteerBrowser,
  type BrowserContext as PuppeteerBrowserContext,
  type Dialog as PuppeteerDialog,
  type ElementHandle as PuppeteerElementHandle,
  type KeyInput,
  type Page as PuppeteerPage,
} from "puppeteer-core";
import type * as Playwright from "playwright";

export interface AutomationBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AutomationConsoleMessage {
  type(): string;
  text(): string;
  location(): { url?: string };
}

export interface AutomationDialog {
  accept(promptText?: string): Promise<void>;
  dismiss(): Promise<void>;
}

export interface AutomationLocator {
  first(): AutomationLocator;
  nth(index: number): AutomationLocator;
  filter(options: { hasText: string }): AutomationLocator;
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
  innerText(): Promise<string>;
  ariaSnapshot(): Promise<string>;
  evaluate<R>(fn: (element: unknown) => R | Promise<R>): Promise<R>;
  screenshot(options: { type: "png" | "jpeg"; quality?: number }): Promise<Buffer>;
  click(options?: {
    button?: "left" | "right" | "middle";
    modifiers?: string[];
    timeout?: number;
  }): Promise<void>;
  dblclick(options?: { button?: "left" | "right" | "middle"; timeout?: number }): Promise<void>;
  dispatchEvent(type: string): Promise<void>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  selectOption(value: string | string[]): Promise<void>;
  scrollIntoViewIfNeeded(): Promise<void>;
  dragTo(target: AutomationLocator): Promise<void>;
  boundingBox(): Promise<AutomationBox | null>;
  setInputFiles(paths: string[]): Promise<void>;
  waitFor(options: {
    state: "visible" | "hidden" | "attached" | "detached";
    timeout: number;
  }): Promise<void>;
}

export interface AutomationMouse {
  click(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
  down(): Promise<void>;
  up(): Promise<void>;
}

export interface AutomationKeyboard {
  insertText(text: string): Promise<void>;
  type(text: string, options?: { delay?: number }): Promise<void>;
  press(key: string, options?: { delay?: number }): Promise<void>;
}

export interface AutomationPage {
  url(): string;
  title(): Promise<string>;
  close(): Promise<void>;
  onClose(listener: () => void): void;
  onConsole(listener: (message: AutomationConsoleMessage) => void): void;
  onDialog(listener: (dialog: AutomationDialog) => Promise<void>): void;
  goto(
    url: string,
    options: { waitUntil: "load" | "domcontentloaded" | "networkidle"; timeout: number }
  ): Promise<void>;
  goBack(options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<void>;
  goForward(options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<void>;
  reload(options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<void>;
  locator(selector: string): AutomationLocator;
  screenshot(options: {
    fullPage: boolean;
    type: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer>;
  pdf(options: {
    format: "letter" | "a4";
    landscape: boolean;
    printBackground: boolean;
  }): Promise<Buffer>;
  addStyleTag(options: { content: string }): Promise<void>;
  textContent(selector: string): Promise<string | null>;
  evaluate<R>(script: string): Promise<R>;
  waitForTimeout(timeMs: number): Promise<void>;
  waitForSelector(
    selector: string,
    options: {
      timeout: number;
      state?: "visible" | "hidden" | "attached" | "detached";
    }
  ): Promise<void>;
  waitForURL(url: string, options: { timeout: number }): Promise<void>;
  waitForLoadState(
    state: "load" | "domcontentloaded" | "networkidle",
    options?: { timeout?: number }
  ): Promise<void>;
  viewportSize(): { width: number; height: number } | null;
  setViewportSize(viewport: { width: number; height: number }): Promise<void>;
  mouse: AutomationMouse;
  keyboard: AutomationKeyboard;
}

interface BrowserEvent {
  initEvent(type: string, bubbles: boolean, cancelable: boolean): void;
}

interface BrowserDocument {
  createEvent(type: string): BrowserEvent;
  readyState: string;
}

interface BrowserElement {
  tagName: string;
  type?: string;
  textContent: string | null;
  innerText?: string;
  ownerDocument: BrowserDocument;
  getAttribute(name: string): string | null;
  dispatchEvent(event: BrowserEvent): boolean;
  focus(): void;
}

interface BrowserInputElement extends BrowserElement {
  value: string;
}

interface BrowserSelectOption {
  value: string;
  selected: boolean;
}

interface BrowserSelectElement extends BrowserElement {
  options: BrowserSelectOption[];
}

interface BrowserLocation {
  href: string;
}

interface BrowserElementEvaluator {
  evaluate<R>(fn: (element: unknown) => R | Promise<R>): Promise<R>;
}

export interface AutomationContext {
  newPage(): Promise<AutomationPage>;
  close(): Promise<void>;
}

export interface AutomationBrowser {
  newContext(options: { viewport: { width: number; height: number } }): Promise<AutomationContext>;
  onDisconnected(listener: () => void): void;
  close(): Promise<void>;
}

export type AutomationDriverName = "playwright" | "puppeteer";

export function automationDriverForPlatform(platform: NodeJS.Platform): AutomationDriverName {
  return platform === "win32" ? "puppeteer" : "playwright";
}

function normalizePuppeteerSelector(selector: string): string {
  if (selector.startsWith("xpath=")) return `::-p-xpath(${selector.slice(6)})`;
  if (selector.startsWith("text=")) return `::-p-text(${selector.slice(5)})`;
  return selector;
}

class PlaywrightLocatorAdapter implements AutomationLocator {
  constructor(private readonly locator: Playwright.Locator) {}

  first(): AutomationLocator {
    return new PlaywrightLocatorAdapter(this.locator.first());
  }

  nth(index: number): AutomationLocator {
    return new PlaywrightLocatorAdapter(this.locator.nth(index));
  }

  filter(options: { hasText: string }): AutomationLocator {
    return new PlaywrightLocatorAdapter(this.locator.filter(options));
  }

  count(): Promise<number> {
    return this.locator.count();
  }

  isVisible(): Promise<boolean> {
    return this.locator.isVisible();
  }

  getAttribute(name: string): Promise<string | null> {
    return this.locator.getAttribute(name);
  }

  innerText(): Promise<string> {
    return this.locator.innerText();
  }

  ariaSnapshot(): Promise<string> {
    return this.locator.ariaSnapshot();
  }

  evaluate<R>(fn: (element: unknown) => R | Promise<R>): Promise<R> {
    return (this.locator as unknown as BrowserElementEvaluator).evaluate(fn);
  }

  async screenshot(options: { type: "png" | "jpeg"; quality?: number }): Promise<Buffer> {
    return Buffer.from(await this.locator.screenshot(options));
  }

  click(options?: {
    button?: "left" | "right" | "middle";
    modifiers?: string[];
    timeout?: number;
  }): Promise<void> {
    return this.locator.click({
      button: options?.button,
      modifiers: options?.modifiers as Array<
        "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift"
      >,
      timeout: options?.timeout,
    });
  }

  dblclick(options?: { button?: "left" | "right" | "middle"; timeout?: number }): Promise<void> {
    return this.locator.dblclick(options);
  }

  dispatchEvent(type: string): Promise<void> {
    return this.locator.dispatchEvent(type);
  }

  fill(value: string): Promise<void> {
    return this.locator.fill(value);
  }

  press(key: string): Promise<void> {
    return this.locator.press(key);
  }

  async selectOption(value: string | string[]): Promise<void> {
    await this.locator.selectOption(value);
  }

  scrollIntoViewIfNeeded(): Promise<void> {
    return this.locator.scrollIntoViewIfNeeded();
  }

  async dragTo(target: AutomationLocator): Promise<void> {
    if (!(target instanceof PlaywrightLocatorAdapter)) {
      throw new Error("Cannot drag between different browser drivers");
    }
    await this.locator.dragTo(target.locator);
  }

  boundingBox(): Promise<AutomationBox | null> {
    return this.locator.boundingBox();
  }

  async setInputFiles(paths: string[]): Promise<void> {
    await this.locator.setInputFiles(paths);
  }

  waitFor(options: {
    state: "visible" | "hidden" | "attached" | "detached";
    timeout: number;
  }): Promise<void> {
    return this.locator.waitFor(options);
  }
}

class PlaywrightPageAdapter implements AutomationPage {
  readonly mouse: AutomationMouse;
  readonly keyboard: AutomationKeyboard;

  constructor(private readonly page: Playwright.Page) {
    this.mouse = {
      click: async (x, y) => await page.mouse.click(x, y),
      move: async (x, y) => await page.mouse.move(x, y),
      wheel: async (deltaX, deltaY) => await page.mouse.wheel(deltaX, deltaY),
      down: async () => await page.mouse.down(),
      up: async () => await page.mouse.up(),
    };
    this.keyboard = {
      insertText: async (text) => await page.keyboard.insertText(text),
      type: async (text, options) => await page.keyboard.type(text, options),
      press: async (key, options) => await page.keyboard.press(key, options),
    };
  }

  url(): string {
    return this.page.url();
  }

  title(): Promise<string> {
    return this.page.title();
  }

  close(): Promise<void> {
    return this.page.close();
  }

  onClose(listener: () => void): void {
    this.page.on("close", listener);
  }

  onConsole(listener: (message: AutomationConsoleMessage) => void): void {
    this.page.on("console", listener);
  }

  onDialog(listener: (dialog: AutomationDialog) => Promise<void>): void {
    this.page.on("dialog", listener);
  }

  async goto(
    url: string,
    options: { waitUntil: "load" | "domcontentloaded" | "networkidle"; timeout: number }
  ): Promise<void> {
    await this.page.goto(url, options);
  }

  async goBack(options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<void> {
    await this.page.goBack(options);
  }

  async goForward(options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<void> {
    await this.page.goForward(options);
  }

  async reload(options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<void> {
    await this.page.reload(options);
  }

  locator(selector: string): AutomationLocator {
    return new PlaywrightLocatorAdapter(this.page.locator(selector));
  }

  async screenshot(options: {
    fullPage: boolean;
    type: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer> {
    return Buffer.from(await this.page.screenshot(options));
  }

  async pdf(options: {
    format: "letter" | "a4";
    landscape: boolean;
    printBackground: boolean;
  }): Promise<Buffer> {
    return Buffer.from(await this.page.pdf(options));
  }

  async addStyleTag(options: { content: string }): Promise<void> {
    await this.page.addStyleTag(options);
  }

  textContent(selector: string): Promise<string | null> {
    return this.page.textContent(selector);
  }

  evaluate<R>(script: string): Promise<R> {
    return this.page.evaluate(script);
  }

  waitForTimeout(timeMs: number): Promise<void> {
    return this.page.waitForTimeout(timeMs);
  }

  async waitForSelector(
    selector: string,
    options: {
      timeout: number;
      state?: "visible" | "hidden" | "attached" | "detached";
    }
  ): Promise<void> {
    await this.page.waitForSelector(selector, options);
  }

  waitForURL(url: string, options: { timeout: number }): Promise<void> {
    return this.page.waitForURL(url, options);
  }

  waitForLoadState(
    state: "load" | "domcontentloaded" | "networkidle",
    options?: { timeout?: number }
  ): Promise<void> {
    return this.page.waitForLoadState(state, options);
  }

  viewportSize(): { width: number; height: number } | null {
    return this.page.viewportSize();
  }

  setViewportSize(viewport: { width: number; height: number }): Promise<void> {
    return this.page.setViewportSize(viewport);
  }
}

class PlaywrightContextAdapter implements AutomationContext {
  constructor(private readonly context: Playwright.BrowserContext) {}

  async newPage(): Promise<AutomationPage> {
    return new PlaywrightPageAdapter(await this.context.newPage());
  }

  close(): Promise<void> {
    return this.context.close();
  }
}

class PlaywrightBrowserAdapter implements AutomationBrowser {
  constructor(private readonly browser: Playwright.Browser) {}

  async newContext(options: {
    viewport: { width: number; height: number };
  }): Promise<AutomationContext> {
    return new PlaywrightContextAdapter(await this.browser.newContext(options));
  }

  onDisconnected(listener: () => void): void {
    this.browser.on("disconnected", listener);
  }

  close(): Promise<void> {
    return this.browser.close();
  }
}

class PuppeteerDialogAdapter implements AutomationDialog {
  constructor(private readonly dialog: PuppeteerDialog) {}

  accept(promptText?: string): Promise<void> {
    return this.dialog.accept(promptText);
  }

  dismiss(): Promise<void> {
    return this.dialog.dismiss();
  }
}

class PuppeteerLocatorAdapter implements AutomationLocator {
  constructor(
    private readonly page: PuppeteerPage,
    private readonly selector: string,
    private readonly index: number | null = null,
    private readonly hasText: string | null = null
  ) {}

  first(): AutomationLocator {
    return new PuppeteerLocatorAdapter(this.page, this.selector, 0, this.hasText);
  }

  nth(index: number): AutomationLocator {
    return new PuppeteerLocatorAdapter(this.page, this.selector, index, this.hasText);
  }

  filter(options: { hasText: string }): AutomationLocator {
    return new PuppeteerLocatorAdapter(this.page, this.selector, this.index, options.hasText);
  }

  private async handles(): Promise<Array<PuppeteerElementHandle<Element>>> {
    const handles = await this.page.$$(normalizePuppeteerSelector(this.selector));
    if (!this.hasText) return handles;
    const matches: Array<PuppeteerElementHandle<Element>> = [];
    for (const handle of handles) {
      const text = await handle.evaluate((element) => element.textContent ?? "");
      if (text.includes(this.hasText)) matches.push(handle);
    }
    return matches;
  }

  private async handle(): Promise<PuppeteerElementHandle<Element>> {
    const handles = await this.handles();
    const handle = handles[this.index ?? 0];
    if (!handle) throw new Error(`Element not found: ${this.selector}`);
    return handle;
  }

  async count(): Promise<number> {
    return (await this.handles()).length;
  }

  async isVisible(): Promise<boolean> {
    const handles = await this.handles();
    const handle = handles[this.index ?? 0];
    return handle ? await handle.isVisible() : false;
  }

  async getAttribute(name: string): Promise<string | null> {
    return await (await this.handle()).evaluate(
      (element, attribute) => (element as unknown as BrowserElement).getAttribute(attribute),
      name
    );
  }

  async innerText(): Promise<string> {
    return await (await this.handle()).evaluate((element) => {
      const browserElement = element as unknown as BrowserElement;
      return browserElement.innerText ?? browserElement.textContent ?? "";
    });
  }

  ariaSnapshot(): Promise<string> {
    return this.innerText();
  }

  evaluate<R>(fn: (element: unknown) => R | Promise<R>): Promise<R> {
    return this.handle().then((handle) =>
      (handle as unknown as BrowserElementEvaluator).evaluate(fn)
    );
  }

  async screenshot(options: { type: "png" | "jpeg"; quality?: number }): Promise<Buffer> {
    return Buffer.from(await (await this.handle()).screenshot(options));
  }

  async click(options?: {
    button?: "left" | "right" | "middle";
    modifiers?: string[];
    timeout?: number;
  }): Promise<void> {
    const modifiers = (options?.modifiers ?? []).map((modifier) =>
      modifier === "ControlOrMeta" ? "Control" : modifier
    );
    for (const modifier of modifiers) await this.page.keyboard.down(modifier as KeyInput);
    try {
      await (await this.handle()).click({ button: options?.button });
    } finally {
      for (const modifier of modifiers.reverse()) {
        await this.page.keyboard.up(modifier as KeyInput);
      }
    }
  }

  async dblclick(options?: {
    button?: "left" | "right" | "middle";
    timeout?: number;
  }): Promise<void> {
    const handle = await this.handle();
    await handle.click({ button: options?.button });
    await handle.click({ button: options?.button });
  }

  async dispatchEvent(type: string): Promise<void> {
    await (await this.handle()).evaluate((element, eventType) => {
      const browserElement = element as unknown as BrowserElement;
      const event = browserElement.ownerDocument.createEvent("Event");
      event.initEvent(eventType, true, true);
      browserElement.dispatchEvent(event);
    }, type);
  }

  async fill(value: string): Promise<void> {
    const handle = await this.handle();
    await handle.evaluate((element) => {
      const input = element as unknown as BrowserInputElement;
      input.focus();
      input.value = "";
      const event = input.ownerDocument.createEvent("Event");
      event.initEvent("input", true, false);
      input.dispatchEvent(event);
    });
    await this.page.keyboard.type(value);
  }

  async press(key: string): Promise<void> {
    await (await this.handle()).focus();
    await this.page.keyboard.press(key as KeyInput);
  }

  async selectOption(value: string | string[]): Promise<void> {
    const values = Array.isArray(value) ? value : [value];
    await (await this.handle()).evaluate((element, selectedValues) => {
      const select = element as unknown as BrowserSelectElement;
      if (select.tagName.toLowerCase() !== "select") throw new Error("Element is not a select");
      for (const option of select.options) {
        option.selected = selectedValues.includes(option.value);
      }
      for (const type of ["input", "change"]) {
        const event = select.ownerDocument.createEvent("Event");
        event.initEvent(type, true, false);
        select.dispatchEvent(event);
      }
    }, values);
  }

  async scrollIntoViewIfNeeded(): Promise<void> {
    await (await this.handle()).scrollIntoView();
  }

  async dragTo(target: AutomationLocator): Promise<void> {
    if (!(target instanceof PuppeteerLocatorAdapter)) {
      throw new Error("Cannot drag between different browser drivers");
    }
    const sourceBox = await this.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !targetBox) throw new Error("Drag target is not visible");
    await this.page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2
    );
    await this.page.mouse.down();
    await this.page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 12 }
    );
    await this.page.mouse.up();
  }

  async boundingBox(): Promise<AutomationBox | null> {
    return await (await this.handle()).boundingBox();
  }

  async setInputFiles(paths: string[]): Promise<void> {
    const handle = await this.handle();
    if (
      !(await handle.evaluate((element) => {
        const input = element as unknown as BrowserElement;
        return input.tagName.toLowerCase() === "input" && input.type === "file";
      }))
    ) {
      throw new Error("Element is not a file input");
    }
    await (handle as PuppeteerElementHandle<HTMLInputElement>).uploadFile(...paths);
  }

  async waitFor(options: {
    state: "visible" | "hidden" | "attached" | "detached";
    timeout: number;
  }): Promise<void> {
    const deadline = Date.now() + options.timeout;
    while (Date.now() <= deadline) {
      const count = await this.count();
      const visible = count > 0 && (await this.isVisible());
      if (options.state === "attached" && count > 0) return;
      if (options.state === "detached" && count === 0) return;
      if (options.state === "visible" && visible) return;
      if (options.state === "hidden" && !visible) return;
      await Bun.sleep(50);
    }
    throw new Error(`Timed out waiting for ${this.selector} to become ${options.state}`);
  }
}

class PuppeteerPageAdapter implements AutomationPage {
  readonly mouse: AutomationMouse;
  readonly keyboard: AutomationKeyboard;

  constructor(private readonly page: PuppeteerPage) {
    this.mouse = {
      click: async (x, y) => await page.mouse.click(x, y),
      move: async (x, y) => await page.mouse.move(x, y),
      wheel: async (deltaX, deltaY) => await page.mouse.wheel({ deltaX, deltaY }),
      down: async () => await page.mouse.down(),
      up: async () => await page.mouse.up(),
    };
    this.keyboard = {
      insertText: async (text) => await page.keyboard.sendCharacter(text),
      type: async (text, options) => await page.keyboard.type(text, options),
      press: async (key, options) => await page.keyboard.press(key as KeyInput, options),
    };
  }

  url(): string {
    return this.page.url();
  }

  title(): Promise<string> {
    return this.page.title();
  }

  close(): Promise<void> {
    return this.page.close();
  }

  onClose(listener: () => void): void {
    this.page.on("close", listener);
  }

  onConsole(listener: (message: AutomationConsoleMessage) => void): void {
    this.page.on("console", listener);
  }

  onDialog(listener: (dialog: AutomationDialog) => Promise<void>): void {
    this.page.on("dialog", (dialog) => void listener(new PuppeteerDialogAdapter(dialog)));
  }

  async goto(
    url: string,
    options: { waitUntil: "load" | "domcontentloaded" | "networkidle"; timeout: number }
  ): Promise<void> {
    const waitUntil = options.waitUntil === "networkidle" ? "networkidle0" : options.waitUntil;
    await this.page.goto(url, { waitUntil, timeout: options.timeout });
  }

  async goBack(options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<void> {
    await this.page.goBack(options);
  }

  async goForward(options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<void> {
    await this.page.goForward(options);
  }

  async reload(options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<void> {
    await this.page.reload(options);
  }

  locator(selector: string): AutomationLocator {
    return new PuppeteerLocatorAdapter(this.page, selector);
  }

  async screenshot(options: {
    fullPage: boolean;
    type: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer> {
    return Buffer.from(await this.page.screenshot(options));
  }

  async pdf(options: {
    format: "letter" | "a4";
    landscape: boolean;
    printBackground: boolean;
  }): Promise<Buffer> {
    return Buffer.from(await this.page.pdf(options));
  }

  async addStyleTag(options: { content: string }): Promise<void> {
    await this.page.addStyleTag(options);
  }

  textContent(selector: string): Promise<string | null> {
    return this.page.$eval(
      normalizePuppeteerSelector(selector),
      (element) => (element as unknown as BrowserElement).textContent
    );
  }

  evaluate<R>(script: string): Promise<R> {
    return this.page.evaluate(script) as Promise<R>;
  }

  async waitForTimeout(timeMs: number): Promise<void> {
    await Bun.sleep(timeMs);
  }

  async waitForSelector(
    selector: string,
    options: {
      timeout: number;
      state?: "visible" | "hidden" | "attached" | "detached";
    }
  ): Promise<void> {
    await this.locator(selector).waitFor({
      state: options.state ?? "visible",
      timeout: options.timeout,
    });
  }

  async waitForURL(url: string, options: { timeout: number }): Promise<void> {
    await this.page.waitForFunction(
      (expected) =>
        (globalThis as unknown as { location: BrowserLocation }).location.href === expected,
      { timeout: options.timeout },
      url
    );
  }

  async waitForLoadState(
    state: "load" | "domcontentloaded" | "networkidle",
    options?: { timeout?: number }
  ): Promise<void> {
    const timeout = options?.timeout ?? 30_000;
    if (state === "networkidle") {
      await this.page.waitForNetworkIdle({ timeout });
      return;
    }
    const expected = state === "load" ? "complete" : "interactive";
    await this.page.waitForFunction(
      (readyState) =>
        (globalThis as unknown as { document: BrowserDocument }).document.readyState ===
          "complete" ||
        (globalThis as unknown as { document: BrowserDocument }).document.readyState === readyState,
      { timeout },
      expected
    );
  }

  viewportSize(): { width: number; height: number } | null {
    return this.page.viewport();
  }

  async setViewportSize(viewport: { width: number; height: number }): Promise<void> {
    await this.page.setViewport(viewport);
  }
}

class PuppeteerContextAdapter implements AutomationContext {
  constructor(
    private readonly context: PuppeteerBrowserContext,
    private readonly viewport: { width: number; height: number }
  ) {}

  async newPage(): Promise<AutomationPage> {
    const page = await this.context.newPage();
    await page.setViewport(this.viewport);
    return new PuppeteerPageAdapter(page);
  }

  close(): Promise<void> {
    return this.context.close();
  }
}

class PuppeteerBrowserAdapter implements AutomationBrowser {
  constructor(private readonly browser: PuppeteerBrowser) {}

  async newContext(options: {
    viewport: { width: number; height: number };
  }): Promise<AutomationContext> {
    return new PuppeteerContextAdapter(await this.browser.createBrowserContext(), options.viewport);
  }

  onDisconnected(listener: () => void): void {
    this.browser.on("disconnected", listener);
  }

  close(): Promise<void> {
    return this.browser.close();
  }
}

export function wrapPlaywrightBrowser(browser: Playwright.Browser): AutomationBrowser {
  return new PlaywrightBrowserAdapter(browser);
}

export async function launchPuppeteerBrowser(options: {
  executablePath: string;
  headless: boolean;
  args: string[];
  timeout: number;
}): Promise<AutomationBrowser> {
  return new PuppeteerBrowserAdapter(
    await puppeteer.launch({
      executablePath: options.executablePath,
      headless: options.headless,
      args: options.args,
      timeout: options.timeout,
    })
  );
}
