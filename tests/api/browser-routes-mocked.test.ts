import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

type NavigateCall = {
  id: string;
  url: string;
  opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" };
};

type ClickCall = {
  id: string;
  selector: string;
  opts?: { button?: "left" | "right" | "middle"; doubleClick?: boolean };
};

type TypeCall = {
  id: string;
  selector: string;
  text: string;
  opts?: { submit?: boolean; clear?: boolean };
};

const browserMockState = {
  statusCalls: 0,
  tabsCalls: 0,
  createCalls: 0,
  createdPageIds: [] as string[],
  closePageCalls: [] as string[],
  navigateCalls: [] as NavigateCall[],
  snapshotCalls: [] as string[],
  screenshotCalls: [] as string[],
  resizeCalls: [] as Array<{ id: string; width: number; height: number }>,
  clickCalls: [] as ClickCall[],
  coordinateClickCalls: [] as Array<{ id: string; x: number; y: number }>,
  scrollCalls: [] as Array<{ id: string; deltaX: number; deltaY: number }>,
  keyCalls: [] as Array<{ id: string; key: string }>,
  typeCalls: [] as TypeCall[],
  closeAllCalls: 0,
};

mock.module("../../src/core/browser/pw-manager", () => ({
  getStatus: async () => {
    browserMockState.statusCalls += 1;
    return { running: true, profile: "mock-profile", currentUrl: "https://example.com" };
  },
  getAllPages: async () => {
    browserMockState.tabsCalls += 1;
    return [
      { id: "tab-1", url: "https://example.com", title: "Example Domain" },
      ...browserMockState.createdPageIds.map((id) => ({ id, url: "about:blank", title: "" })),
    ];
  },
  getPageSummary: async (id: string) =>
    id === "missing" ? null : { id, url: "https://example.com", title: "Example Domain" },
  createPage: async () => {
    browserMockState.createCalls += 1;
    browserMockState.createdPageIds.push("tab-created");
    return "tab-created";
  },
  getPageById: (id: string) => (id === "tab-created" ? { id } : undefined),
  closePage: async (id: string) => {
    browserMockState.closePageCalls.push(id);
    return id !== "missing";
  },
  navigate: async (
    id: string,
    url: string,
    opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" }
  ) => {
    browserMockState.navigateCalls.push({ id, url, opts });
    return { id, url, title: "Mock Page" };
  },
  getSnapshot: async (id: string) => {
    browserMockState.snapshotCalls.push(id);
    return { markdown: "# Snapshot", elements: [] };
  },
  screenshot: async (id: string) => {
    browserMockState.screenshotCalls.push(id);
    return Buffer.from("img");
  },
  resize: async (id: string, width: number, height: number) => {
    browserMockState.resizeCalls.push({ id, width, height });
  },
  getViewportSize: () => ({ width: 1280, height: 800 }),
  getPointerState: () => ({
    x: 64,
    y: 72,
    visible: true,
    updatedAt: 1000,
    action: "click",
    source: "agent",
  }),
  goBack: async (id: string) => ({ id, url: "https://previous.example", title: "Previous" }),
  goForward: async (id: string) => ({ id, url: "https://next.example", title: "Next" }),
  reload: async (id: string) => ({ id, url: "https://example.com", title: "Example Domain" }),
  click: async (
    id: string,
    selector: string,
    opts?: { button?: "left" | "right" | "middle"; doubleClick?: boolean }
  ) => {
    browserMockState.clickCalls.push({ id, selector, opts });
  },
  clickAt: async (id: string, x: number, y: number) => {
    browserMockState.coordinateClickCalls.push({ id, x, y });
  },
  scrollPage: async (id: string, deltaX: number, deltaY: number) => {
    browserMockState.scrollCalls.push({ id, deltaX, deltaY });
  },
  sendKey: async (id: string, key: string) => {
    browserMockState.keyCalls.push({ id, key });
  },
  type: async (
    id: string,
    selector: string,
    text: string,
    opts?: { submit?: boolean; clear?: boolean }
  ) => {
    browserMockState.typeCalls.push({ id, selector, text, opts });
  },
  closeAll: async () => {
    browserMockState.closeAllCalls += 1;
  },
}));

let handleRequest: (req: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}) => Promise<{ status: number; headers: Record<string, string>; body?: unknown }>;

function resetState() {
  browserMockState.statusCalls = 0;
  browserMockState.tabsCalls = 0;
  browserMockState.createCalls = 0;
  browserMockState.createdPageIds = [];
  browserMockState.closePageCalls = [];
  browserMockState.navigateCalls = [];
  browserMockState.snapshotCalls = [];
  browserMockState.screenshotCalls = [];
  browserMockState.resizeCalls = [];
  browserMockState.clickCalls = [];
  browserMockState.coordinateClickCalls = [];
  browserMockState.scrollCalls = [];
  browserMockState.keyCalls = [];
  browserMockState.typeCalls = [];
  browserMockState.closeAllCalls = 0;
}

async function api(method: string, path: string, body?: unknown) {
  return await handleRequest({
    method,
    url: `http://localhost:4269${path}`,
    headers: { host: "localhost:4269", "sec-fetch-site": "same-origin" },
    body,
  });
}

describe("Browser route contracts (mocked manager)", () => {
  beforeAll(() => {
    const routes = require("../../src/api/routes") as {
      handleRequest: typeof handleRequest;
    };
    handleRequest = routes.handleRequest;
  });

  beforeEach(() => {
    resetState();
  });

  test("GET /api/browser/status returns mocked status and calls manager", async () => {
    const res = await api("GET", "/api/browser/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      running: true,
      profile: "mock-profile",
      currentUrl: "https://example.com",
    });
    expect(browserMockState.statusCalls).toBe(1);
  });

  test("GET /api/browser/tabs returns mocked tabs array", async () => {
    const res = await api("GET", "/api/browser/tabs");
    expect(res.status).toBe(200);
    expect((res.body as { tabs: unknown[] }).tabs).toEqual([
      { id: "tab-1", url: "https://example.com", title: "Example Domain" },
    ]);
    expect(browserMockState.tabsCalls).toBe(1);
  });

  test("POST /api/browser/tabs creates a page", async () => {
    const res = await api("POST", "/api/browser/tabs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: "tab-created" } });
    expect(browserMockState.createCalls).toBe(1);
  });

  test("browser tabs bind the preview page to one chat session", async () => {
    const create = await api("POST", "/api/browser/tabs", { sessionId: "chat-session-1" });
    expect(create.body).toEqual({ success: true, data: { id: "tab-created" } });

    const list = await api("GET", "/api/browser/tabs?sessionId=chat-session-1");
    expect(list.body).toEqual({
      tabs: [{ id: "tab-created", url: "about:blank", title: "" }],
    });
  });

  test("DELETE /api/browser/tabs/:id returns not found when manager returns false", async () => {
    const res = await api("DELETE", "/api/browser/tabs/missing");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ error: "Page not found" });
    expect(browserMockState.closePageCalls).toEqual(["missing"]);
  });

  test("POST /api/browser/tabs/:id/navigate forwards url and waitUntil", async () => {
    const res = await api("POST", "/api/browser/tabs/tab-9/navigate", {
      url: "https://bun.sh",
      waitUntil: "domcontentloaded",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { id: "tab-9", url: "https://bun.sh/", title: "Mock Page" },
    });
    expect(browserMockState.navigateCalls).toEqual([
      {
        id: "tab-9",
        url: "https://bun.sh/",
        opts: { waitUntil: "domcontentloaded" },
      },
    ]);
  });

  test("POST /api/browser/tabs/:id/navigate allows loopback previews", async () => {
    const res = await api("POST", "/api/browser/tabs/tab-9/navigate", {
      url: "http://127.0.0.1:4269/api/config",
      waitUntil: "domcontentloaded",
    });

    expect(res.status).toBe(200);
    expect(browserMockState.navigateCalls[0]?.url).toBe("http://127.0.0.1:4269/api/config");
  });

  test("POST /api/browser/tabs/:id/navigate normalizes host-only addresses", async () => {
    const res = await api("POST", "/api/browser/tabs/tab-9/navigate", {
      url: "google.com",
      waitUntil: "domcontentloaded",
    });

    expect(res.status).toBe(200);
    expect(browserMockState.navigateCalls[0]?.url).toBe("https://google.com/");
  });

  test("POST /api/browser/tabs/:id/navigate allows private LAN browser pages", async () => {
    const res = await api("POST", "/api/browser/tabs/tab-9/navigate", {
      url: "http://192.168.1.73:4269/api/config",
      waitUntil: "domcontentloaded",
    });

    expect(res.status).toBe(200);
    expect(browserMockState.navigateCalls[0]?.url).toBe("http://192.168.1.73:4269/api/config");
  });

  test("GET /api/browser/tabs/:id/snapshot forwards id", async () => {
    const res = await api("GET", "/api/browser/tabs/tab-2/snapshot");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { markdown: "# Snapshot", elements: [] },
    });
    expect(browserMockState.snapshotCalls).toEqual(["tab-2"]);
  });

  test("GET /api/browser/tabs/:id/state returns lightweight cursor telemetry", async () => {
    const res = await api("GET", "/api/browser/tabs/tab-1/state");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        viewport: { width: 1280, height: 800 },
        cursor: {
          x: 64,
          y: 72,
          visible: true,
          updatedAt: 1000,
          action: "click",
          source: "agent",
        },
        page: { id: "tab-1", url: "https://example.com", title: "Example Domain" },
      },
    });
  });

  test("GET /api/browser/tabs/:id/screenshot base64 encodes buffer", async () => {
    const res = await api("GET", "/api/browser/tabs/tab-1/screenshot");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        screenshot: "aW1n",
        contentType: "image/png",
        viewport: { width: 1280, height: 800 },
        cursor: {
          x: 64,
          y: 72,
          visible: true,
          updatedAt: 1000,
          action: "click",
          source: "agent",
        },
        page: { id: "tab-1", url: "https://example.com", title: "Example Domain" },
      },
    });
    expect(browserMockState.screenshotCalls).toEqual(["tab-1"]);
    expect(browserMockState.resizeCalls).toEqual([{ id: "tab-1", width: 1280, height: 800 }]);
  });

  test("POST /api/browser/tabs/:id/click validates selector and forwards options", async () => {
    const invalid = await api("POST", "/api/browser/tabs/tab-1/click", {});
    expect(invalid.status).toBe(200);
    expect(invalid.body).toEqual({ error: "Selector is required" });
    expect(browserMockState.clickCalls).toEqual([]);

    const valid = await api("POST", "/api/browser/tabs/tab-1/click", {
      selector: "#submit",
      button: "right",
      doubleClick: true,
    });
    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({ success: true, message: "Clicked element" });
    expect(browserMockState.clickCalls).toEqual([
      {
        id: "tab-1",
        selector: "#submit",
        opts: { button: "right", doubleClick: true },
      },
    ]);
  });

  test("browser preview pointer, wheel, and keyboard routes forward user input", async () => {
    const click = await api("POST", "/api/browser/tabs/tab-1/pointer/click", { x: 80, y: 120 });
    const scroll = await api("POST", "/api/browser/tabs/tab-1/scroll", {
      deltaX: 0,
      deltaY: 9000,
    });
    const key = await api("POST", "/api/browser/tabs/tab-1/keyboard", { key: "Enter" });
    expect(click.body).toEqual({ success: true, message: "Clicked page" });
    expect(scroll.body).toEqual({ success: true, message: "Scrolled page" });
    expect(key.body).toEqual({ success: true, message: "Sent key" });
    expect(browserMockState.coordinateClickCalls).toEqual([{ id: "tab-1", x: 80, y: 120 }]);
    expect(browserMockState.scrollCalls).toEqual([{ id: "tab-1", deltaX: 0, deltaY: 4000 }]);
    expect(browserMockState.keyCalls).toEqual([{ id: "tab-1", key: "Enter" }]);
  });

  test("POST /api/browser/tabs/:id/type validates input and forwards options", async () => {
    const invalid = await api("POST", "/api/browser/tabs/tab-1/type", {
      selector: "",
      text: "",
    });
    expect(invalid.status).toBe(200);
    expect(invalid.body).toEqual({ error: "Selector and text are required" });
    expect(browserMockState.typeCalls).toEqual([]);

    const valid = await api("POST", "/api/browser/tabs/tab-1/type", {
      selector: "#query",
      text: "cybara",
      submit: true,
      clear: true,
    });
    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({ success: true, message: "Typed text" });
    expect(browserMockState.typeCalls).toEqual([
      {
        id: "tab-1",
        selector: "#query",
        text: "cybara",
        opts: { submit: true, clear: true },
      },
    ]);
  });

  test("POST /api/browser/close calls closeAll", async () => {
    const res = await api("POST", "/api/browser/close");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "Browser closed" });
    expect(browserMockState.closeAllCalls).toBe(1);
  });
});
