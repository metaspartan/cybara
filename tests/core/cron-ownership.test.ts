import { describe, expect, test } from "bun:test";

const cronToolSource = await Bun.file("src/core/tools/handlers/channel-utilities.ts").text();
const storeSource = await Bun.file("src/core/source-migration-opencode-store.ts").text();
const migrationSource = await Bun.file("src/core/source-migration.ts").text();

describe("cron job ownership", () => {
  test("caller-supplied agent and workspace are stripped before the job is created", () => {
    expect(cronToolSource).toContain("agentId: _requestedAgentId");
    expect(cronToolSource).toContain("workspaceDir: _requestedWorkspaceDir");
    expect(cronToolSource).toContain("...jobWithoutOwnership");
  });

  test("ownership is taken from the calling context only", () => {
    expect(cronToolSource).toContain("context?.agentId ? { agentId: context.agentId }");
    expect(cronToolSource).toContain(
      "context?.workspaceDir ? { workspaceDir: context.workspaceDir }"
    );
  });
});

describe("migration source labelling", () => {
  test("the session store records the real source instead of a hardcoded one", () => {
    expect(storeSource).toContain("migration_source: migrationSource");
    expect(storeSource).not.toContain('migration_source: "opencode"');
  });

  test("non-OpenCode migrations pass their own source kind to the store", () => {
    expect(migrationSource.replace(/\s+/g, " ")).toContain(
      "createCybaraOpenCodeSessionStore( sourceKind )"
    );
  });
});
