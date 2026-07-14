import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_MEMORY_PROVIDER_SETTINGS,
  MEMORY_PROVIDER_ADAPTERS,
  REDACTED_SECRET_SENTINEL,
  captureToExternalMemory,
  getActiveMemoryProviderAdapter,
  getMemoryProviderCatalog,
  mergeMemoryProviderSettingsUpdate,
  normalizeMemoryProviderId,
  normalizeMemoryProviderSettings,
  recallFromExternalMemory,
  redactMemoryProviderSettings,
  testMemoryProvider,
  type MemoryProviderSettings,
} from "../../src/core/memory/providers";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

function settingsWith(patch: Partial<MemoryProviderSettings>): MemoryProviderSettings {
  return normalizeMemoryProviderSettings({ ...DEFAULT_MEMORY_PROVIDER_SETTINGS, ...patch });
}

describe("memory provider settings", () => {
  test("normalize falls back to safe defaults for garbage input", () => {
    const normalized = normalizeMemoryProviderSettings({
      provider: "nonsense",
      autoRecall: "yes",
      supermemory: { apiKey: 42, baseUrl: "javascript:alert(1)" },
    });
    expect(normalized.provider).toBe("local");
    expect(normalized.autoRecall).toBe(true);
    expect(normalized.supermemory.apiKey).toBe("");
    expect(normalized.supermemory.baseUrl).toBe("https://api.supermemory.ai");
  });

  test("normalizeMemoryProviderId accepts known ids and aliases", () => {
    expect(normalizeMemoryProviderId("SUPERMEMORY")).toBe("supermemory");
    expect(normalizeMemoryProviderId("builtin")).toBe("local");
    expect(normalizeMemoryProviderId("")).toBe("local");
    expect(normalizeMemoryProviderId("unknown")).toBe("local");
  });

  test("redact replaces stored secrets and merge keeps them on echo", () => {
    const stored = settingsWith({
      provider: "mem0",
      mem0: { apiKey: "sk-real", baseUrl: "https://api.mem0.ai", userId: "u", agentId: "a" },
    });
    const redacted = redactMemoryProviderSettings(stored);
    expect(redacted.mem0.apiKey).toBe(REDACTED_SECRET_SENTINEL);
    expect(redacted.supermemory.apiKey).toBe("");

    const merged = mergeMemoryProviderSettingsUpdate(stored, {
      ...redacted,
      mem0: { ...redacted.mem0, userId: "new-user" },
    });
    expect(merged.mem0.apiKey).toBe("sk-real");
    expect(merged.mem0.userId).toBe("new-user");

    const replaced = mergeMemoryProviderSettingsUpdate(stored, {
      ...redacted,
      mem0: { ...redacted.mem0, apiKey: "sk-new" },
    });
    expect(replaced.mem0.apiKey).toBe("sk-new");
  });

  test("merge rejects moving a redacted key to another destination", () => {
    const stored = settingsWith({
      provider: "mem0",
      mem0: { apiKey: "sk-real", baseUrl: "https://api.mem0.ai", userId: "u", agentId: "a" },
    });
    const redacted = redactMemoryProviderSettings(stored);

    expect(() =>
      mergeMemoryProviderSettingsUpdate(stored, {
        ...redacted,
        mem0: {
          ...redacted.mem0,
          baseUrl: "https://replacement.invalid",
        },
      })
    ).toThrow("must be re-entered");

    const replaced = mergeMemoryProviderSettingsUpdate(stored, {
      ...redacted,
      mem0: {
        ...redacted.mem0,
        apiKey: "sk-replacement",
        baseUrl: "https://replacement.invalid",
      },
    });
    expect(replaced.mem0.apiKey).toBe("sk-replacement");
  });

  test("catalog marks configured and active providers", () => {
    const settings = settingsWith({
      provider: "supermemory",
      supermemory: { apiKey: "sk-x", baseUrl: "https://api.supermemory.ai", containerTag: "c" },
    });
    const catalog = getMemoryProviderCatalog(settings);
    const ids = catalog.map((entry) => entry.id);
    expect(ids).toEqual(["local", "supermemory", "mem0", "honcho", "openviking", "hindsight"]);
    const supermemory = catalog.find((entry) => entry.id === "supermemory");
    expect(supermemory?.configured).toBe(true);
    expect(supermemory?.active).toBe(true);
    const mem0 = catalog.find((entry) => entry.id === "mem0");
    expect(mem0?.configured).toBe(false);
    expect(mem0?.active).toBe(false);
  });

  test("active adapter requires both selection and configuration", () => {
    expect(getActiveMemoryProviderAdapter(settingsWith({ provider: "local" }))).toBeUndefined();
    expect(
      getActiveMemoryProviderAdapter(settingsWith({ provider: "supermemory" }))
    ).toBeUndefined();
    const configured = settingsWith({
      provider: "supermemory",
      supermemory: { apiKey: "sk-x", baseUrl: "https://api.supermemory.ai", containerTag: "" },
    });
    expect(getActiveMemoryProviderAdapter(configured)?.id).toBe("supermemory");
  });
});

describe("memory provider adapters", () => {
  test("supermemory store and search hit the documented v3 endpoints", async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith("/v3/documents")) return Response.json({ id: "doc1" });
      if (url.endsWith("/v3/search")) {
        return Response.json({
          results: [{ documentId: "d1", score: 0.9, chunks: [{ content: "User likes Bun" }] }],
        });
      }
      return new Response("not found", { status: 404 });
    });
    const settings = settingsWith({
      provider: "supermemory",
      supermemory: { apiKey: "sk-x", baseUrl: "https://api.supermemory.ai", containerTag: "cy" },
    });
    const adapter = MEMORY_PROVIDER_ADAPTERS.supermemory;
    await adapter.store(settings, "User likes Bun", { category: "preference" });
    const results = await adapter.search(settings, "bun", 3);
    expect(results).toEqual([{ id: "d1", content: "User likes Bun", score: 0.9 }]);

    expect(calls[0].url).toBe("https://api.supermemory.ai/v3/documents");
    const storeBody = JSON.parse(String(calls[0].init?.body));
    expect(storeBody.containerTag).toBe("cy");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-x");
    const searchBody = JSON.parse(String(calls[1].init?.body));
    expect(searchBody.q).toBe("bun");
    expect(searchBody.containerTags).toEqual(["cy"]);
  });

  test("mem0 uses Token auth, user scoping, and verbatim (infer:false) stores", async () => {
    const calls = mockFetch((url) => {
      if (url.includes("/v1/memories/search/")) {
        return Response.json([{ id: "m1", memory: "Prefers dark mode", score: 0.8 }]);
      }
      return Response.json({ ok: true });
    });
    const settings = settingsWith({
      provider: "mem0",
      mem0: { apiKey: "mk", baseUrl: "https://api.mem0.ai", userId: "u1", agentId: "a1" },
    });
    const adapter = MEMORY_PROVIDER_ADAPTERS.mem0;
    await adapter.store(settings, "Prefers dark mode");
    const results = await adapter.search(settings, "dark mode", 5);
    expect(results[0]).toEqual({ id: "m1", content: "Prefers dark mode", score: 0.8 });

    expect(calls[0].url).toBe("https://api.mem0.ai/v1/memories/");
    const storeBody = JSON.parse(String(calls[0].init?.body));
    expect(storeBody.user_id).toBe("u1");
    expect(storeBody.infer).toBe(false);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Token mk");
  });

  test("hindsight retain/recall paths include tenant and bank", async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith("/memories/recall")) {
        return Response.json({ results: [{ id: "h1", text: "Fact", score: 0.7 }] });
      }
      return Response.json({ ok: true });
    });
    const settings = settingsWith({
      provider: "hindsight",
      hindsight: {
        apiKey: "hk",
        baseUrl: "https://api.hindsight.vectorize.io",
        tenant: "default",
        bankId: "cybara",
      },
    });
    const adapter = MEMORY_PROVIDER_ADAPTERS.hindsight;
    await adapter.store(settings, "Fact");
    const results = await adapter.search(settings, "fact", 4);
    expect(results[0].content).toBe("Fact");
    expect(calls[0].url).toBe(
      "https://api.hindsight.vectorize.io/v1/default/banks/cybara/memories"
    );
    expect(calls[1].url).toBe(
      "https://api.hindsight.vectorize.io/v1/default/banks/cybara/memories/recall"
    );
  });

  test("honcho stores peer messages and searches via dialectic chat", async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith("/chat")) return Response.json({ content: "The user likes hiking." });
      return Response.json({ ok: true });
    });
    const settings = settingsWith({
      provider: "honcho",
      honcho: { apiKey: "hk", baseUrl: "https://api.honcho.dev", workspace: "w1", peer: "p1" },
    });
    const adapter = MEMORY_PROVIDER_ADAPTERS.honcho;
    await adapter.store(settings, "Likes hiking");
    const results = await adapter.search(settings, "hobbies", 3);
    expect(results).toEqual([{ content: "The user likes hiking." }]);
    expect(calls[0].url).toBe("https://api.honcho.dev/v2/workspaces/w1/peers/p1/messages");
    expect(calls[1].url).toBe("https://api.honcho.dev/v2/workspaces/w1/peers/p1/chat");
  });

  test("openviking writes viking:// content and searches via find", async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith("/api/v1/search/find")) {
        return Response.json({ result: { items: [{ uri: "viking://x", abstract: "Note" }] } });
      }
      return Response.json({ ok: true });
    });
    const settings = settingsWith({
      provider: "openviking",
      openviking: { apiKey: "", baseUrl: "http://127.0.0.1:1933" },
    });
    const adapter = MEMORY_PROVIDER_ADAPTERS.openviking;
    await adapter.store(settings, "Note", { category: "fact" });
    const results = await adapter.search(settings, "note", 2);
    expect(results[0]).toMatchObject({ id: "viking://x", content: "Note" });
    expect(calls[0].url).toBe("http://127.0.0.1:1933/api/v1/content/write");
    const storeBody = JSON.parse(String(calls[0].init?.body));
    expect(storeBody.uri.startsWith("viking://user/memories/fact/")).toBe(true);
  });
});

describe("capture and recall helpers never throw", () => {
  test("capture is a no-op when local or unconfigured, best-effort on errors", async () => {
    mockFetch(() => new Response("boom", { status: 500 }));
    expect(await captureToExternalMemory(settingsWith({ provider: "local" }), "x")).toBe(false);
    expect(await captureToExternalMemory(settingsWith({ provider: "mem0" }), "x")).toBe(false);
    const configured = settingsWith({
      provider: "mem0",
      mem0: { apiKey: "k", baseUrl: "https://api.mem0.ai", userId: "u", agentId: "a" },
    });
    expect(await captureToExternalMemory(configured, "x")).toBe(false);
    expect(await captureToExternalMemory({ ...configured, autoCapture: false }, "x")).toBe(false);
  });

  test("recall swallows provider failures and returns []", async () => {
    mockFetch(() => {
      throw new Error("network down");
    });
    const configured = settingsWith({
      provider: "supermemory",
      supermemory: { apiKey: "k", baseUrl: "https://api.supermemory.ai", containerTag: "" },
    });
    expect(await recallFromExternalMemory(configured, "query")).toEqual([]);
    expect(await recallFromExternalMemory({ ...configured, autoRecall: false }, "query")).toEqual(
      []
    );
  });

  test("testMemoryProvider reports local always-ok and unconfigured externals", async () => {
    const local = await testMemoryProvider("local", settingsWith({}));
    expect(local.ok).toBe(true);
    const unconfigured = await testMemoryProvider("mem0", settingsWith({}));
    expect(unconfigured.ok).toBe(false);
    expect(unconfigured.detail).toContain("not configured");
  });
});
