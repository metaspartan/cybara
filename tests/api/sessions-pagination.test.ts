import { afterEach, describe, expect, test } from "bun:test";
import db from "../../src/core/database";
import {
  listSessionPage,
  listSessions,
  deleteSession,
  getSession,
  setSessionPinned,
  type ChatMessage,
} from "../../src/api/chat";
import { persistSession, setPersistedSessionTitle } from "../../src/core/session-context";
import { logSessionMessage } from "../../src/core/logging";

const createdSessionIds: string[] = [];

function makeSessionId(label: string): string {
  return `test-session-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createPersistedSession(params: {
  label: string;
  updatedAt: string;
  userPrompt: string;
  assistantReply: string;
  title?: string;
}): Promise<string> {
  const sessionId = makeSessionId(params.label);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: "System prompt",
      timestamp: "2099-01-01T00:00:00.000Z",
    },
    {
      role: "user",
      content: params.userPrompt,
      timestamp: "2099-01-01T00:00:01.000Z",
    },
    {
      role: "assistant",
      content: params.assistantReply,
      timestamp: "2099-01-01T00:00:02.000Z",
    },
  ];

  await persistSession(
    sessionId,
    "test-agent",
    messages,
    null,
    params.title ?? `Title ${params.label}`
  );
  for (const message of messages) {
    if (message.role === "system") continue;
    await logSessionMessage(sessionId, message.role, message.content, {
      agentId: "test-agent",
    });
  }
  db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(
    params.updatedAt,
    sessionId
  );
  createdSessionIds.push(sessionId);
  return sessionId;
}

afterEach(async () => {
  while (createdSessionIds.length > 0) {
    const id = createdSessionIds.pop();
    if (!id) continue;
    await deleteSession(id);
  }
});

describe("session listing pagination", () => {
  test("returns deterministic pages with limit and offset", async () => {
    const oldest = await createPersistedSession({
      label: "oldest",
      updatedAt: "2099-01-01T00:00:10.000Z",
      userPrompt: "old prompt",
      assistantReply: "old reply",
    });
    const middle = await createPersistedSession({
      label: "middle",
      updatedAt: "2099-01-01T00:00:20.000Z",
      userPrompt: "mid prompt",
      assistantReply: "mid reply",
    });
    const newest = await createPersistedSession({
      label: "newest",
      updatedAt: "2099-01-01T00:00:30.000Z",
      userPrompt: "new prompt",
      assistantReply: "new reply",
    });

    const orderedSessions = await listSessions({ limit: 1000, offset: 0 });
    const seededOffset = orderedSessions.findIndex((session) => session.id === newest);
    expect(seededOffset).toBeGreaterThanOrEqual(0);

    const firstPage = await listSessions({ limit: 2, offset: seededOffset });
    const secondPage = await listSessions({ limit: 1, offset: seededOffset + 2 });

    const firstPageIds = firstPage.slice(0, 2).map((session) => session.id);
    const secondPageFirstId = secondPage[0]?.id;

    expect(firstPageIds).toEqual([newest, middle]);
    expect(secondPageFirstId).toBe(oldest);

    const newestSession = firstPage.find((session) => session.id === newest);
    expect(newestSession?.messageCount).toBe(2);
    expect(newestSession?.lastMessage?.content).toContain("new reply");
  });

  test("keeps bounded pages correct after sessions are resident in memory", async () => {
    const id = await createPersistedSession({
      label: "resident-page",
      updatedAt: "2099-01-01T00:01:00.000Z",
      userPrompt: "resident page prompt",
      assistantReply: "resident page reply",
    });

    await getSession(id);
    const page = await listSessionPage({ limit: 1, offset: 0 });
    const residentSession = (await listSessions({ limit: 1000 })).find(
      (session) => session.id === id
    );

    expect(page.sessions).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(1);
    expect(residentSession?.messageCount).toBe(2);
  });

  test("pinned sessions sort above more-recent unpinned ones", async () => {
    const older = await createPersistedSession({
      label: "pin-older",
      updatedAt: "2099-02-01T00:00:10.000Z",
      userPrompt: "older prompt",
      assistantReply: "older reply",
    });
    const newer = await createPersistedSession({
      label: "pin-newer",
      updatedAt: "2099-02-01T00:00:30.000Z",
      userPrompt: "newer prompt",
      assistantReply: "newer reply",
    });

    // Without pinning, the newer session leads.
    let sessions = await listSessions();
    let olderIndex = sessions.findIndex((s) => s.id === older);
    let newerIndex = sessions.findIndex((s) => s.id === newer);
    expect(newerIndex).toBeLessThan(olderIndex);
    expect(sessions[olderIndex]?.pinned).toBe(false);

    // Pin the older one — it should jump above the newer, unpinned session.
    await setSessionPinned(older, true);
    sessions = await listSessions();
    olderIndex = sessions.findIndex((s) => s.id === older);
    newerIndex = sessions.findIndex((s) => s.id === newer);
    expect(olderIndex).toBeLessThan(newerIndex);
    expect(sessions[olderIndex]?.pinned).toBe(true);

    // Unpin restores recency ordering.
    await setSessionPinned(older, false);
    sessions = await listSessions();
    expect(sessions.find((s) => s.id === older)?.pinned).toBe(false);
    expect(sessions.findIndex((s) => s.id === newer)).toBeLessThan(
      sessions.findIndex((s) => s.id === older)
    );
  });

  test("truncates last message previews in session listings", async () => {
    const longReply = `reply-${"x".repeat(2000)}`;
    const id = await createPersistedSession({
      label: "long-preview",
      updatedAt: "2099-01-02T00:00:10.000Z",
      userPrompt: "long preview prompt",
      assistantReply: longReply,
    });

    const session = (await listSessions({ limit: 10 })).find((entry) => entry.id === id);

    expect(session?.lastMessage?.content.startsWith("reply-")).toBe(true);
    expect(session?.lastMessage?.content.endsWith("...")).toBe(true);
    expect(session?.lastMessage?.content.length).toBeLessThan(longReply.length);
    expect(JSON.stringify(session).length).toBeLessThan(2000);
  });

  test("returns total metadata for bounded session pages", async () => {
    const older = await createPersistedSession({
      label: "page-total-older",
      updatedAt: "2099-01-03T00:00:10.000Z",
      userPrompt: "older page total prompt",
      assistantReply: "older page total reply",
    });
    const newest = await createPersistedSession({
      label: "page-total-newest",
      updatedAt: "2099-01-03T00:00:30.000Z",
      userPrompt: "newest page total prompt",
      assistantReply: "newest page total reply",
    });

    const allSessions = await listSessions();
    const page = await listSessionPage({ limit: 1, offset: 0 });

    expect(allSessions.map((session) => session.id)).toEqual(
      expect.arrayContaining([older, newest])
    );
    expect(page.sessions[0]?.id).toBe(allSessions[0]?.id);
    expect(page.sessions).toHaveLength(1);
    expect(page.total).toBe(allSessions.length);
    expect(page.limit).toBe(1);
    expect(page.offset).toBe(0);
    expect(page.hasMore).toBe(allSessions.length > 1);
  });

  test("pin survives a title update (not reset by persistence)", async () => {
    const id = await createPersistedSession({
      label: "pin-persist",
      updatedAt: "2099-03-01T00:00:10.000Z",
      userPrompt: "persist prompt",
      assistantReply: "persist reply",
    });

    await setSessionPinned(id, true);
    expect((await listSessions()).find((s) => s.id === id)?.pinned).toBe(true);

    // A subsequent title update must not clear the pin.
    await setPersistedSessionTitle(id, "Renamed while pinned");
    const after = await listSessions();
    const session = after.find((s) => s.id === id);
    expect(session?.pinned).toBe(true);
    expect(session?.title).toBe("Renamed while pinned");
  });

  test("strips legacy agent prefixes from listed chat titles", async () => {
    const id = await createPersistedSession({
      label: "prefixed-title",
      updatedAt: "2099-04-01T00:00:10.000Z",
      userPrompt: "audit agent platform",
      assistantReply: "audit reply",
      title: "test-agent: Audit agent platform",
    });

    const session = (await listSessions()).find((s) => s.id === id);

    expect(session?.title).toBe("Audit agent platform");
  });

  test("setSessionPinned reports found=false for an unknown session", async () => {
    const result = await setSessionPinned("does-not-exist-" + Date.now(), true);
    expect(result.found).toBe(false);
  });
});
