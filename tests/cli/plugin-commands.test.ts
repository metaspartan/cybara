import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { type CliPluginFetch, createCliPluginCommands } from "../../src/cli-plugin-commands";

const logSpy = spyOn(console, "log").mockImplementation(() => undefined);

afterEach(() => {
  logSpy.mockClear();
});

afterAll(() => {
  logSpy.mockRestore();
});

describe("CLI plugin commands", () => {
  test("lists plugins through the plugin API client", async () => {
    const requests: string[] = [];
    const fetchAPI: CliPluginFetch = async <T>(endpoint: string): Promise<T | null> => {
      requests.push(endpoint);
      return {
        plugins: [
          {
            id: "example",
            name: "Example",
            version: "1.0.0",
            description: "Example plugin",
            source: "local",
            rootDir: "/tmp/example",
            skillDirs: [],
            skillCount: 0,
            enabled: true,
          },
        ],
      } as T;
    };

    await createCliPluginCommands(fetchAPI, "http://localhost:4269").list();

    expect(requests).toEqual(["/api/plugins"]);
    expect(logSpy).toHaveBeenCalledWith("- Example (1.0.0)");
  });

  test("sends enabled state to the selected plugin", async () => {
    const requests: Array<{ endpoint: string; options?: RequestInit }> = [];
    const fetchAPI: CliPluginFetch = async <T>(
      endpoint: string,
      options?: RequestInit
    ): Promise<T | null> => {
      requests.push({ endpoint, options });
      return {
        success: true,
        plugin: {
          id: "example",
          name: "Example",
          version: "1.0.0",
          description: "Example plugin",
          source: "local",
          rootDir: "/tmp/example",
          skillDirs: [],
          skillCount: 0,
          enabled: false,
        },
      } as T;
    };

    await createCliPluginCommands(fetchAPI, "http://localhost:4269").setEnabled("example", false);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.endpoint).toBe("/api/plugins/example");
    expect(requests[0]?.options?.method).toBe("PUT");
    expect(requests[0]?.options?.body).toBe(JSON.stringify({ enabled: false }));
  });
});
