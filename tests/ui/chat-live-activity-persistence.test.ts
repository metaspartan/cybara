import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  applyLiveActivityEvent,
  buildPreSteeringActivityMessage,
  canUseNativeSpeechRecognition,
  isAgentUsingBrowser,
  isRawToolCallThought,
  pruneCanonicalizedLiveActivities,
  resolveDictationRuntime,
  resolveStatusSnapshotActivities,
} from "../../ui/src/pages/chat/chatModel";
import type { ChatMessage } from "../../ui/src/pages/chat/chatModel";
import type { LiveActivityItem } from "../../ui/src/lib/chatActivities";

const chatSourcePath = join(process.cwd(), "ui", "src", "pages", "Chat.tsx");
const chatModelPath = join(process.cwd(), "ui", "src", "pages", "chat", "chatModel.ts");

describe("Chat live activity persistence", () => {
  test("shows browser activity only while a browser tool is in flight for the active session", () => {
    const browserStart: LiveActivityItem = {
      id: "browser-start",
      phase: "start",
      text: "Opening browser",
      timestamp: 1783300001000,
      toolName: "browser",
      toolCallId: "browser-1",
    };
    const browserResult = { ...browserStart, phase: "result" as const, text: "Opened browser" };

    expect(isAgentUsingBrowser([browserStart], true)).toBe(true);
    expect(isAgentUsingBrowser([browserStart], false)).toBe(false);
    expect(isAgentUsingBrowser([browserResult], true)).toBe(false);
    expect(
      isAgentUsingBrowser(
        [{ ...browserStart, toolName: "web_search", text: "Searching the web" }],
        true
      )
    ).toBe(false);
  });

  test("hides provider tool-call envelopes that arrive as thought activity", () => {
    expect(
      isRawToolCallThought({
        toolName: "__thought",
        text: "<read><file>/tmp/provider-tool-result.txt</file></read>",
      })
    ).toBe(true);
    expect(
      isRawToolCallThought({
        toolName: "__thought",
        text: "Inspecting the repository structure.",
      })
    ).toBe(false);
  });

  test("keeps a dedicated run activity buffer for post-completion rendering", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("const runActivityBufferRef = useRef<LiveActivityItem[]>([])");
    expect(source).toContain("const runActivities =");
    expect(source).toContain("activities: runActivities.map((activity) => ({ ...activity }))");
  });

  test("does not clear live activities on idle while a request is still loading", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("!loadingRef.current &&");
    expect(source).toContain("activeSessionRef.current === resolvedSessionId &&");
    expect(source).toContain("!nextActiveIds.includes(resolvedSessionId)");
    expect(source).toContain("if (!loadingRef.current) {");
    expect(source).toContain("setLiveActivities([]);");
    expect(source).toContain("runActivityBufferRef.current = [];");
  });

  test("clears the temporary live timeline after attaching it to the completed assistant message", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("pendingProcessCaptureRef.current = null;");
    expect(source).toContain("runActivityBufferRef.current = [];");
    expect(source).toContain("setLiveActivities([]);");
    expect(source).toContain("setLiveCurrentStep(null);");
  });

  test("uses server event timestamps when appending live activities to preserve order", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("eventTimestamp?: number");
    expect(source).toContain(
      'typeof event.timestamp === "number" && Number.isFinite(event.timestamp)'
    );
    expect(source).toMatch(
      /appendLiveActivity\(\s*phase,\s*text,\s*payload\.toolName,\s*eventTimestamp,\s*payload\.toolCallId,\s*payload\.sandboxProvider\s*\);/
    );
  });

  test("long-running tool completion keeps its original timeline position", () => {
    const baseTimestamp = 1_783_700_000_000;
    const activities: LiveActivityItem[] = [
      {
        id: "tool-start",
        phase: "start",
        text: "Running repository tests",
        timestamp: baseTimestamp,
        toolName: "exec",
        toolCallId: "long-command",
      },
      {
        id: "thought",
        phase: "result",
        text: "Reviewing another issue",
        timestamp: baseTimestamp + 1,
        toolName: "__thought",
      },
    ];

    const completed = applyLiveActivityEvent(activities, {
      phase: "result",
      text: "Ran repository tests",
      timestamp: baseTimestamp + 25 * 60_000,
      toolName: "exec",
      toolCallId: "long-command",
    });

    expect(completed).toHaveLength(2);
    expect(completed.map((activity) => activity.text)).toEqual([
      "Ran repository tests",
      "Reviewing another issue",
    ]);
    expect(completed[0]?.timestamp).toBe(baseTimestamp);
    expect(completed.some((activity) => activity.phase === "start")).toBe(false);
  });

  test("ignores stale polling snapshots that arrive after newer SSE events", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("latestStatusTimestampBySessionRef");
    expect(source).toContain("snapshotLatest + 25 < latestKnownTimestamp");
  });

  test("keeps remounted live activities when queue snapshots have no activity rows", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    const localActivities: LiveActivityItem[] = [
      {
        id: "tool-1-result",
        phase: "result",
        text: "Ran repo review command",
        timestamp: 1783300001000,
        toolName: "exec",
        toolCallId: "tool-1",
      },
    ];
    const serverActivities: LiveActivityItem[] = [
      {
        id: "tool-2-start",
        phase: "start",
        text: "Exploring package.json",
        timestamp: 1783300002000,
        toolName: "read",
        toolCallId: "tool-2",
      },
    ];

    expect(resolveStatusSnapshotActivities([], localActivities, "thinking")).toEqual(
      localActivities
    );
    expect(resolveStatusSnapshotActivities([], localActivities, "generating")).toEqual(
      localActivities
    );
    expect(resolveStatusSnapshotActivities([], localActivities, "idle")).toEqual([]);
    expect(resolveStatusSnapshotActivities(serverActivities, localActivities, "thinking")).toEqual(
      serverActivities
    );
    expect(source).toContain("const liveActivitiesRef = useRef<LiveActivityItem[]>([])");
    expect(source).toContain("resolveStatusSnapshotActivities(");
    expect(source).toContain("const resolveSnapshotLiveState = useCallback");
    expect(source).toContain("cacheLiveStatusSnapshot(snapshot)");
  });

  test("clears stale running step text after a tool completion with no in-flight step", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain(
      "const nextActiveStep = getLatestInFlightStep(runActivityBufferRef.current);"
    );
    expect(source).toContain("if (nextActiveStep) {");
    expect(source).toContain("setLiveCurrentStep(nextActiveStep);");
    expect(source).toContain("} else {");
    expect(source).toContain("setLiveCurrentStep(null);");
  });

  test("renders worked duration when duration is defined", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain('t("chat.workedFor", {');
    expect(source).toContain("formatWorkedDuration(workedDurationMs)");
    expect(source).toContain('"0h 00m 00s"');
  });

  test("does not truncate activity timeline display lists", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).not.toContain("activities.slice(-20)");
    expect(source).not.toContain(".slice(-50)");
    expect(source).not.toContain("finalizeCompletedActivities(processActivities).slice(-8)");
  });

  test("keeps the working timeline visible while the session remains active", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain(
      "const currentSessionIsLoading = isLoading && loadingSessionId === sessionId;"
    );
    expect(source).toContain("const showWorkingTimeline =");
    expect(source).toContain("currentSessionIsLoading ||");
    expect(source).toContain("currentSessionIsActive ||");
    expect(source).toContain("pendingCaptureForCurrentSession ||");
    expect(source).toContain(
      'const timelineStatus =\n    currentSessionIsActive && liveStatus === "idle" ? ("thinking" as const) : liveStatus;'
    );
  });

  test("restores cached live state when a chat route remounts", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("readCachedLiveSessionState(sessionId)");
    expect(source).toContain("writeCachedLiveSessionState(sessionId");
    expect(source).toContain("clearCachedLiveSessionState(sessionId)");
    expect(source).toContain("setStreamingContent(cached.streamingContent)");
  });

  test("keeps streamed assistant text visible until the final assistant message is attached", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("if (!streamingContent || isLoading) return;");
    expect(source).toContain('if (latestMessage?.role === "assistant") {');
    // Clearing now happens via finalizeLiveState AFTER the persisted reply is
    // fetched (see chat-finish-handoff.test.ts), never inline before it.
    expect(source).toMatch(/const finalizeLiveState = \(\) => \{\s*setStreamingContent\(null\);/);
  });

  test("persists message process map across reloads", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain('const MESSAGE_PROCESS_MAP_STORAGE_KEY = "cybara:messageProcessMap"');
    expect(source).toContain("readPersistedMessageProcessMap()");
    expect(source).toContain("persistMessageProcessMap(messageProcessMap)");
  });

  test("prunes remounted live activities already embedded in persisted messages", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: "run a slow command",
        timestamp: "2026-07-06T00:00:00.000Z",
      },
      {
        role: "assistant",
        content: "",
        timestamp: "2026-07-06T00:00:01.000Z",
        process_activities: [
          {
            id: "activity-before-steer",
            phase: "result",
            text: "Ran slow command before steering",
            timestamp: 1783300001000,
            toolName: "exec",
            toolCallId: "tool-before-steer",
          },
        ],
      },
      {
        role: "user",
        content: "steer now",
        timestamp: "2026-07-06T00:00:02.000Z",
      },
    ];
    const activities: LiveActivityItem[] = [
      {
        id: "activity-before-steer",
        phase: "result",
        text: "Ran slow command before steering",
        timestamp: 1783300001000,
        toolName: "exec",
        toolCallId: "tool-before-steer",
      },
      {
        id: "activity-after-steer",
        phase: "start",
        text: "Starting queued follow-up",
        timestamp: 1783300002000,
        toolName: "__thought",
      },
    ];

    expect(pruneCanonicalizedLiveActivities(messages, activities)).toEqual([activities[1]]);
  });

  test("materializes live tool activity immediately before a steered user message", () => {
    const steeredMessage: ChatMessage = {
      role: "user",
      content: "steer now",
      timestamp: "2026-07-06T00:00:02.000Z",
    };
    const activity: LiveActivityItem = {
      id: "activity-before-steer",
      phase: "result",
      text: "Ran slow command before steering",
      timestamp: 1783300001000,
      toolName: "exec",
      toolCallId: "tool-before-steer",
    };

    const materialized = buildPreSteeringActivityMessage(steeredMessage, [activity]);

    expect(materialized).toMatchObject({
      role: "assistant",
      content: "",
      timestamp: "2026-07-06T00:00:01.999Z",
      process_activities: [activity],
    });
  });

  test("does not fold steering handoff markers into the pre-steer work row", () => {
    const steeredMessage: ChatMessage = {
      role: "user",
      content: "steer now",
      timestamp: "2026-07-06T00:00:02.000Z",
    };

    const materialized = buildPreSteeringActivityMessage(steeredMessage, [
      {
        id: "handoff",
        phase: "result",
        text: "Steering to follow-up...",
        timestamp: 1783300001000,
        toolName: "__thought",
      },
      {
        id: "work",
        phase: "result",
        text: "Ran slow command before steering",
        timestamp: 1783300001001,
        toolName: "exec",
        toolCallId: "tool-before-steer",
      },
    ]);

    expect(materialized?.process_activities?.map((activity) => activity.text)).toEqual([
      "Ran slow command before steering",
    ]);
  });

  test("steering reloads canonical gateway order and prunes live buffers", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("const preSteerActivities = mergeActivityLists(");
    expect(source).toContain("buildPreSteeringActivityMessage(");
    expect(source).toContain("const refreshed = await loadSessionMutation.mutateAsync(sessionId)");
    expect(source).toContain("materializedMessages = refreshed.messagesList as ChatMessage[]");
    expect(source).not.toContain("appendSessionMessages(sessionId, [preSteerMessage");
    expect(source).toContain("runActivityBufferRef.current = pruneCanonicalizedLiveActivities(");
    expect(source).toContain("pendingProcessCaptureRef.current = {");
  });

  test("shared live activity event merge upgrades starts with matching results", () => {
    const merged = applyLiveActivityEvent(
      [
        {
          id: "start-1",
          phase: "start",
          text: "Running bun test",
          timestamp: 1783300001000,
          toolName: "exec",
          toolCallId: "tool-1",
        },
      ],
      {
        phase: "result",
        text: "Ran bun test",
        timestamp: 1783300002000,
        toolName: "exec",
        toolCallId: "tool-1",
      }
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      phase: "result",
      text: "Ran bun test",
      toolCallId: "tool-1",
    });
  });

  test("does not trim message process map history to last 199 entries", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).not.toContain("Object.entries(previous).slice(-199)");
  });

  test("does not cap persisted message process activities per message", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).not.toContain("MAX_PERSISTED_ACTIVITY_ITEMS_PER_MESSAGE");
    expect(source).not.toContain("normalized.slice(0, MAX_PERSISTED_ACTIVITY_ITEMS_PER_MESSAGE)");
    expect(source).not.toContain("value.slice(0, MAX_PERSISTED_ACTIVITY_ITEMS_PER_MESSAGE)");
  });

  test("infers thought timeline lines from assistant content as a fallback", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("function inferThoughtActivitiesFromContent(");
    expect(source).toContain("!hasPersistedThoughtActivities");
    expect(source).toContain("inferThoughtActivitiesFromContent(");
  });

  test("renders compact work timeline entries instead of large tool cards", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("<ProcessActivityList activities={workActivitiesWithSandbox} />");
    expect(source).not.toContain("function ToolCallItem(");
  });

  test("uses stable message process keys and supports legacy timestamp-key migration", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("function getLegacyMessageProcessKey(");
    expect(source).toContain("function getMessageProcessActivities(");
    expect(source).toContain(
      "const canonicalKey = getMessageProcessKey(sessionId, message, index);"
    );
    expect(source).toContain(
      "const legacyKey = getLegacyMessageProcessKey(sessionId, message, index);"
    );
  });

  test("prefers the best worked duration candidate instead of tiny synthetic tool ranges", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("const durationCandidates: number[] = [];");
    expect(source).toContain("return Math.max(...durationCandidates);");
  });

  test("restores process thoughts from persisted message metadata", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("function normalizeMessageProcessActivities(");
    expect(source).toContain("message.process_activities");
    expect(source).toContain(
      "const embeddedProcessActivities = normalizeMessageProcessActivities("
    );
    expect(source).toContain("function inferThoughtActivitiesFromThinking(");
  });

  test("does not cap inferred thinking timeline lines", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    const functionBody = source.match(
      /function inferThoughtActivitiesFromThinking\([\s\S]*?\n}\n\nfunction resolveWorkedDurationMs/
    )?.[0];
    expect(functionBody).toBeTruthy();
    expect(functionBody).not.toContain(".slice(0, 24)");
  });

  test("supports multiline compose and dictation controls", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("<textarea");
    expect(source).toContain("rows={1}");
    expect(source).toContain("onKeyDown={capabilityPicker.onKeyDown}");
    expect(source).toContain("handleToggleDictation");
    expect(source).toContain("dictationRuntime.unsupportedReason");
    expect(source).toContain('role={dictationError ? "alert" : "status"}');
    expect(source).toContain(
      "canUseNativeSpeechRecognition(!!SpeechCtor, isTauriDesktopRuntime())"
    );
  });

  test("resolves dictation runtime by explicit speech-to-text mode", () => {
    expect(canUseNativeSpeechRecognition(true, false)).toBe(true);
    expect(canUseNativeSpeechRecognition(true, true)).toBe(false);
    expect(
      resolveDictationRuntime("auto", {
        nativeRecognition: true,
        nativeRecorder: false,
        mediaRecorder: true,
        microphone: true,
      }).engine
    ).toBe("native");
    expect(
      resolveDictationRuntime("auto", {
        nativeRecognition: false,
        nativeRecorder: false,
        mediaRecorder: true,
        microphone: true,
      }).engine
    ).toBe("recording");
    expect(
      resolveDictationRuntime("native", {
        nativeRecognition: false,
        nativeRecorder: false,
        mediaRecorder: true,
        microphone: true,
      }).serverProvider
    ).toBe("local");
    expect(
      resolveDictationRuntime("local", {
        nativeRecognition: true,
        nativeRecorder: false,
        mediaRecorder: true,
        microphone: true,
      }).engine
    ).toBe("recording");
    expect(
      resolveDictationRuntime("openai", {
        nativeRecognition: true,
        nativeRecorder: false,
        mediaRecorder: false,
        microphone: true,
      }).unsupportedReason
    ).toContain("record audio");
    expect(
      resolveDictationRuntime("native", {
        nativeRecognition: false,
        nativeRecorder: true,
        mediaRecorder: false,
        microphone: false,
      }).engine
    ).toBe("recording");
  });

  test("keeps sessions panel open on session switch/new session callbacks", () => {
    const source = readFileSync(chatSourcePath, "utf8") + readFileSync(chatModelPath, "utf8");
    expect(source).toContain("setShowSessionsPanel(true);");
    expect(source).toContain("onLoadSession={(");
    expect(source).toContain("loadedWorkspaceDir,");
    expect(source).toContain("loadedAgentId,");
    expect(source).toContain("syncSessionAgentSelection(loadedAgentId);");
    expect(source).toContain("onNewSession={() => {");
    expect(source).toContain("setSessionAgentId(null);");
  });
});
