import { describe, expect, test } from "bun:test";

const indexSource = await Bun.file("src/index.ts").text();
const cronToolSource = await Bun.file("src/core/tools/handlers/channel-utilities.ts").text();

describe("cron agent binding", () => {
  test("the cron agent handler runs the job's own agent instead of any running agent", () => {
    expect(indexSource).toContain("job.agentId\n    ? agentManager.get(job.agentId)");
    expect(indexSource).toContain("no longer exists");
  });

  test("newly scheduled jobs record the agent that created them", () => {
    expect(cronToolSource).toContain(
      'typeof job.agentId === "string" ? job.agentId : context?.agentId'
    );
    expect(cronToolSource).toContain("ownerAgentId ? { agentId: ownerAgentId } : {}");
  });
});
