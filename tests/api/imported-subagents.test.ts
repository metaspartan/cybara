import { describe, expect, test } from "bun:test";
import { createRoutesFixture } from "./routes.fixture";

const fixture = createRoutesFixture();

describe("persisted subagents", () => {
  test("root pagination excludes children even after transcript hydration", async () => {
    const baseline = await fixture.api("GET", "/api/sessions?limit=1&includeTotal=true");
    const root = `root-${crypto.randomUUID()}`;
    const child = `child-${crypto.randomUUID()}`;
    fixture.insertRawSession(root, "default", [{ role: "user", content: "Parent task" }]);
    fixture.insertRawSession(
      child,
      "default",
      [
        { role: "user", content: "Child task" },
        { role: "assistant", content: "Child result" },
      ],
      root
    );
    const before = await fixture.api("GET", "/api/sessions?limit=1&includeTotal=true");
    expect(before.data.total).toBe(baseline.data.total + 1);
    const runs = await fixture.api("GET", `/api/subagents?sessionId=${root}`);
    expect(runs.data).toHaveLength(1);
    expect(runs.data[0]).toMatchObject({
      id: child,
      sessionKey: child,
      requesterSessionId: root,
      status: "completed",
      imported: true,
    });
    const detail = await fixture.api("GET", `/api/subagents/${child}?sessionId=${root}`);
    expect(detail.data).toMatchObject({
      task: "Child task",
      result: "Child result",
      activities: [],
      toolCalls: [],
    });
    const messages = await fixture.api("GET", `/api/subagents/${child}/messages?sessionId=${root}`);
    expect(messages.data.map((message: { content: string }) => message.content)).toEqual([
      "Child task",
      "Child result",
    ]);
    const wrongParent = await fixture.api(
      "GET",
      `/api/subagents/${child}/messages?sessionId=other`
    );
    expect(wrongParent.data.error).toBe("Subagent not found");
    const wrongDetail = await fixture.api("GET", `/api/subagents/${child}?sessionId=other`);
    expect(wrongDetail.data.error).toBe("Subagent not found");
    const after = await fixture.api("GET", "/api/sessions?limit=1&includeTotal=true");
    expect(after.data.total).toBe(before.data.total);
    const all = await fixture.api("GET", "/api/sessions");
    expect(all.data.some((session: { id: string }) => session.id === child)).toBe(false);
    expect(all.data.some((session: { id: string }) => session.id === root)).toBe(true);
    const ids: string[] = [];
    for (let offset = 0; offset < after.data.total; offset++) {
      const page = await fixture.api(
        "GET",
        `/api/sessions?limit=1&offset=${offset}&includeTotal=true`
      );
      expect(page.data.total).toBe(after.data.total);
      ids.push(...page.data.sessions.map((session: { id: string }) => session.id));
    }
    expect(ids).not.toContain(child);
    expect(ids).toContain(root);
    expect(new Set(ids).size).toBe(after.data.total);
    const again = await fixture.api("GET", `/api/subagents?sessionId=${root}`);
    expect(again.data).toEqual(runs.data);
    fixture.deleteRawSession(child);
    fixture.deleteRawSession(root);
  });
});
