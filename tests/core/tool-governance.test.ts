import { describe, expect, test } from "bun:test";
import {
  COMPUTER_USE_ACTION_TOOL_ALIASES,
  COMPUTER_USE_COMPAT_TOOL_ALIASES,
} from "../../src/core/computer-use";
import { PARALLEL_SAFE_TOOLS } from "../../src/core/llm/parallel-tools";
import {
  getDangerousToolNames,
  getToolHandler,
  checkToolPermissions,
  isDangerousTool,
  toolSchemas,
} from "../../src/core/tools/index";

describe("tool governance invariants", () => {
  const parallelSafePermissions = new Set([
    "agents:read",
    "fs:read",
    "memory:read",
    "net:fetch",
    "sessions:list",
    "sessions:read",
  ]);

  test("every advertised tool declares category and permissions metadata", () => {
    const invalid: string[] = [];

    for (const [name, tool] of Object.entries(toolSchemas)) {
      if (!tool.category) invalid.push(`${name}: missing category`);
      if (!Array.isArray(tool.permissions)) invalid.push(`${name}: missing permissions array`);
      if (tool.name !== name) invalid.push(`${name}: schema name mismatch ${tool.name}`);
    }

    expect(invalid).toEqual([]);
  });

  test("dangerous tool registry is backed by the classifier", () => {
    for (const name of getDangerousToolNames()) {
      expect(isDangerousTool(name)).toBe(true);
      expect(toolSchemas[name]).toBeDefined();
    }
  });

  test("multi-capability tools require every declared permission", () => {
    expect(checkToolPermissions(["exec:run", "env:read"], ["exec:run"])).toBe(false);
    expect(checkToolPermissions(["exec:run", "env:read"], ["exec:run", "env:read"])).toBe(true);
    expect(checkToolPermissions(["exec:run", "env:read"], ["*"])).toBe(true);
  });

  test("computer-use direct action aliases are advertised, executable, and dangerous", () => {
    const aliases = [
      ...COMPUTER_USE_ACTION_TOOL_ALIASES,
      ...Object.keys(COMPUTER_USE_COMPAT_TOOL_ALIASES),
    ];
    for (const action of aliases) {
      expect(toolSchemas[action]?.name).toBe(action);
      expect(typeof getToolHandler(action)).toBe("function");
      expect(isDangerousTool(action)).toBe(true);
      expect("required" in toolSchemas[action].input_schema).toBe(false);
    }
  });

  test("parallel-safe tools are real read-only tool schemas", () => {
    const invalid: string[] = [];

    for (const name of PARALLEL_SAFE_TOOLS) {
      const tool = toolSchemas[name];
      if (!tool) {
        invalid.push(`${name}: missing schema`);
        continue;
      }
      if (isDangerousTool(name)) invalid.push(`${name}: dangerous`);
      for (const permission of tool.permissions) {
        if (!parallelSafePermissions.has(permission)) {
          invalid.push(`${name}: non-read-only permission ${permission}`);
        }
      }
    }

    expect(invalid).toEqual([]);
  });

  test("wallet schema separates read-only portfolio actions from fund-moving actions", () => {
    const wallet = toolSchemas.wallet;
    expect(wallet.description).toContain("Read-only actions include status");
    expect(wallet.description).toContain("dry-run swap quotes");
    expect(wallet.description).toContain("Fund-moving or signing actions include sends");
    expect(wallet.description).toContain("explicit user intent");
    expect(String(wallet.input_schema.properties?.action?.description)).toContain(
      "Prefer read-only actions"
    );
  });

  test("account connector writes are approval-gated and reads are not", () => {
    expect(isDangerousTool("account_connector")).toBe(false);
    expect(isDangerousTool("account_connector_write")).toBe(true);
    expect(toolSchemas.account_connector_write.permissions).toContain("connector:write");
    expect(toolSchemas.account_connector.input_schema.properties?.action?.enum).toContain(
      "calendar_list"
    );
    expect(toolSchemas.account_connector.input_schema.properties?.action?.enum).toContain(
      "outlook_search"
    );
    expect(toolSchemas.account_connector.input_schema.properties?.action?.enum).toContain(
      "notion_read"
    );
    expect(toolSchemas.account_connector_write.input_schema.properties?.action?.enum).toContain(
      "calendar_create"
    );
    expect(toolSchemas.account_connector_write.input_schema.properties?.action?.enum).toContain(
      "notion_create_page"
    );
  });

  test("browser profiles do not expose executable or user data paths", () => {
    const properties = toolSchemas.browser.input_schema.properties ?? {};
    expect(properties.executablePath).toBeUndefined();
    expect(properties.userDataDir).toBeUndefined();
    expect(properties.viewportMode?.enum).toEqual(["responsive", "mobile", "desktop"]);
  });
});
