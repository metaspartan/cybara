import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { groupSharedActivities } from "../../shared/chat-activity-groups";
import {
  formatExpandedToolActivityDetail,
  formatStructuredToolActivityDetail,
} from "../../shared/tool-activity-detail";
import {
  buildActivitiesFromToolCalls,
  enrichActivitiesWithToolCallDetails,
  imageViewedSource,
  type LiveActivityItem,
  mergeActivityLists,
} from "../../ui/src/lib/chatActivities";
import { onOpenChatImageLightbox, openChatImageLightbox } from "../../ui/src/lib/chatImageLightbox";
import { applyLiveActivityEvent, formatToolIntent } from "../../ui/src/pages/chat/chatModel";
import { formatIdeStatusEventText } from "../../ui/src/pages/ide/ideActivityHelpers";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const intent = () => "Viewed an image";

describe("image viewed activity sources", () => {
  test("extracts image paths and data URLs from visual tool results", () => {
    expect(imageViewedSource({ name: "read", result: { path: "/tmp/shot.png" } })).toBe(
      "/api/media?path=%2Ftmp%2Fshot.png"
    );
    expect(imageViewedSource({ name: "image", result: { image: "/tmp/photo.jpeg" } })).toBe(
      "/api/media?path=%2Ftmp%2Fphoto.jpeg"
    );
    expect(imageViewedSource({ name: "computer_use", result: { screenshot: PNG_DATA_URL } })).toBe(
      PNG_DATA_URL
    );
    expect(
      imageViewedSource({ name: "mobile_simulator", result: { filePath: "/tmp/ios.webp" } })
    ).toBe("/api/media?path=%2Ftmp%2Fios.webp");
    expect(imageViewedSource({ name: "image", result: { image: "/tmp/clip.avif" } })).toBe(
      "/api/media?path=%2Ftmp%2Fclip.avif"
    );
    expect(imageViewedSource({ name: "image", result: { image: "/tmp/scan.bmp" } })).toBe(
      "/api/media?path=%2Ftmp%2Fscan.bmp"
    );
    expect(imageViewedSource({ name: "image", result: { image: "/tmp/logo.svg" } })).toBe(
      "/api/media?path=%2Ftmp%2Flogo.svg"
    );
    expect(
      imageViewedSource({ name: "image", result: { image: "data:image/avif;base64,AAAA" } })
    ).toBe("data:image/avif;base64,AAAA");
    expect(
      imageViewedSource({ name: "image", result: { image: "/tmp/scan.tiff" } })
    ).toBeUndefined();
  });

  test("prefers the gateway snapshot of a viewed image over the original path", () => {
    const activities = buildActivitiesFromToolCalls(
      [
        {
          id: "call-snapshot",
          name: "image",
          status: "completed",
          arguments: { image: "/Users/carsen/camera_model/renders/tt_06.png", prompt: "look" },
          result: {
            image: "/Users/carsen/camera_model/renders/tt_06.png",
            snapshot: "/Users/carsen/.cybara/media/viewed/abc123/tt_06.png",
          },
        },
      ],
      intent
    );
    expect(activities[0].imageSource).toBe(
      "/api/media?path=" + encodeURIComponent("/Users/carsen/.cybara/media/viewed/abc123/tt_06.png")
    );
    expect(activities[0].imageAlt).toBe("tt_06.png");
  });

  test("ignores non-image results, non-visual tools, and foreign data URLs", () => {
    expect(imageViewedSource({ name: "read", result: { path: "/tmp/notes.md" } })).toBeUndefined();
    expect(imageViewedSource({ name: "read", result: { path: "/tmp/shot" } })).toBeUndefined();
    expect(imageViewedSource({ name: "exec", result: { path: "/tmp/shot.png" } })).toBeUndefined();
    expect(
      imageViewedSource({ name: "read", result: { path: "data:text/html;base64,PGI+" } })
    ).toBeUndefined();
    expect(imageViewedSource({ name: "read", result: "plain text" })).toBeUndefined();
    expect(imageViewedSource({ name: "read", result: undefined })).toBeUndefined();
  });

  test("filesystem paths route through the gateway media endpoint", () => {
    const activities = buildActivitiesFromToolCalls(
      [
        {
          id: "call-media",
          name: "read",
          status: "completed",
          arguments: { path: "/Users/carsen/screenshots/shot.png" },
          result: { path: "/Users/carsen/screenshots/shot.png" },
        },
      ],
      intent
    );
    expect(activities[0].imageSource).toBe(
      "/api/media?path=" + encodeURIComponent("/Users/carsen/screenshots/shot.png")
    );
    expect(activities[0].imageAlt).toBe("shot.png");
  });

  test("build attaches thumbnail metadata to completed image views only", () => {
    const activities = buildActivitiesFromToolCalls(
      [
        {
          id: "call-1",
          name: "read",
          status: "completed",
          arguments: { path: "/tmp/shot.png" },
          result: { path: "/tmp/shot.png" },
        },
        {
          id: "call-2",
          name: "read",
          status: "completed",
          arguments: { path: "/tmp/notes.md" },
          result: { path: "/tmp/notes.md" },
        },
        {
          id: "call-3",
          name: "read",
          status: "executing",
          arguments: { path: "/tmp/live.png" },
        },
      ],
      intent
    );
    expect(activities).toHaveLength(3);
    expect(activities[0].imageSource).toBe("/api/media?path=%2Ftmp%2Fshot.png");
    expect(activities[0].imageAlt).toBe("shot.png");
    expect(activities[1].imageSource).toBeUndefined();
    expect(activities[2].imageSource).toBeUndefined();
  });

  test("merging a cached activity with a fresh one keeps the viewed image", () => {
    const cached: LiveActivityItem = {
      id: "run:4",
      phase: "result",
      text: "Viewed an image",
      timestamp: 10,
      toolName: "image",
      toolCallId: "chatcmpl-tool-b1",
    };
    const fresh: LiveActivityItem = {
      ...cached,
      imageSource: "/api/media?path=%2Ftmp%2Fsnap%2Frender.png",
      imageAlt: "render.png",
    };
    const merged = mergeActivityLists([cached], [fresh]);
    expect(merged).toHaveLength(1);
    expect(merged[0].imageSource).toBe("/api/media?path=%2Ftmp%2Fsnap%2Frender.png");
    expect(merged[0].imageAlt).toBe("render.png");
  });

  test("does not attach an unrelated render when ids do not correlate", () => {
    const activity: LiveActivityItem = {
      id: "tool-uncorrelated",
      phase: "result",
      text: "Viewed an image",
      timestamp: 1,
      toolName: "image",
      toolCallId: "status-image-1",
    };
    const enriched = enrichActivitiesWithToolCallDetails(
      [activity],
      [{ id: "chatcmpl-tool-9", name: "image", result: { image: "/tmp/other.png" } }]
    );
    expect(enriched[0].imageSource).toBeUndefined();
    expect(enriched[0].imageAlt).toBeUndefined();
  });

  test("enrich backfills thumbnail metadata onto matched activities", () => {
    const activity: LiveActivityItem = {
      id: "tool-call-9",
      phase: "result",
      text: "Viewed an image",
      timestamp: 1,
      toolName: "browser_screenshot",
      toolCallId: "call-9",
    };
    const enriched = enrichActivitiesWithToolCallDetails(
      [activity],
      [{ id: "call-9", name: "browser_screenshot", result: { filePath: "/tmp/page.png" } }]
    );
    expect(enriched[0].imageSource).toBe("/api/media?path=%2Ftmp%2Fpage.png");
    expect(enriched[0].imageAlt).toBe("page.png");
  });
});

describe("chat image lightbox bridge", () => {
  test("dispatches and receives lightbox open events", () => {
    const received: Array<{ src: string; alt: string }> = [];
    const off = onOpenChatImageLightbox((image) => received.push(image));
    openChatImageLightbox(PNG_DATA_URL, "shot.png");
    off();
    openChatImageLightbox("ignored.png", "ignored");
    expect(received).toEqual([{ src: PNG_DATA_URL, alt: "shot.png" }]);
  });
});

describe("image viewed timeline contract", () => {
  const timelineSource = readFileSync(
    fileURLToPath(new URL("../../ui/src/pages/chat/ActivityTimeline.tsx", import.meta.url)),
    "utf8"
  );
  const chatSource = readFileSync(
    fileURLToPath(new URL("../../ui/src/pages/Chat.tsx", import.meta.url)),
    "utf8"
  );
  const multiChatSource = readFileSync(
    fileURLToPath(new URL("../../ui/src/pages/chat/MultiChatWorkspace.tsx", import.meta.url)),
    "utf8"
  );
  const modelSource = readFileSync(
    fileURLToPath(new URL("../../ui/src/pages/chat/chatModel.ts", import.meta.url)),
    "utf8"
  );

  test("activity rows render thumbnails that open the lightbox", () => {
    expect(timelineSource).toContain("ImageViewedThumbnail");
    expect(timelineSource).toContain('data-testid="activity-image-viewed-thumbnail"');
    expect(timelineSource).toContain("openChatImageLightbox");
    expect(timelineSource).toContain("loadChatImageSource");
    expect(timelineSource).toContain("event.stopPropagation()");
  });

  test("both chat hosts subscribe to the lightbox bridge", () => {
    expect(chatSource).toContain("onOpenChatImageLightbox");
    expect(chatSource).toContain("setImageLightbox({ images: [image], index: 0 })");
    expect(multiChatSource).toContain("onOpenChatImageLightbox(setLightboxImage)");
  });

  test("persisted activity normalization keeps thumbnail metadata", () => {
    expect(modelSource).toContain("imageSource");
    expect(modelSource).toContain("imageAlt");
  });
});

describe("image viewed activity labels", () => {
  const args = { image: "/tmp/mug_side.png", prompt: "Describe the render" };

  test("shared formatter labels every image view phase", () => {
    expect(formatStructuredToolActivityDetail("image", args, "start")).toBe("Viewing an image");
    expect(formatStructuredToolActivityDetail("image", args, "result")).toBe("Viewed an image");
    expect(formatStructuredToolActivityDetail("image", args, "blocked")).toBe("Image view blocked");
    expect(formatStructuredToolActivityDetail("image", args, "error")).toBe("Image view failed");
    expect(formatExpandedToolActivityDetail("image", args, "result")).toBe(
      "Viewed an image\nImage: mug_side.png\nPrompt: Describe the render"
    );
    expect(formatExpandedToolActivityDetail("image", { image: PNG_DATA_URL }, "result")).toBe(
      undefined
    );
  });

  test("client intent prefers viewed labels over generic gateway fallbacks", () => {
    expect(formatToolIntent("image", args, "start")).toBe("Viewing an image");
    expect(formatToolIntent("image", args, "result", "image complete")).toBe("Viewed an image");
    expect(formatToolIntent("exec", { command: "ls" }, "result", "Ran ls")).toBe("Ran ls");
  });

  test("enrichment upgrades persisted generic image labels and keeps thumbnails", () => {
    const activity: LiveActivityItem = {
      id: "tool-call-3",
      phase: "result",
      text: "image complete",
      timestamp: 1,
      toolName: "image",
      toolCallId: "call-3",
    };
    const enriched = enrichActivitiesWithToolCallDetails(
      [activity],
      [{ id: "call-3", name: "image", args, result: { image: "/tmp/mug_side.png" } }]
    );
    expect(enriched[0].text).toBe("Viewed an image");
    expect(enriched[0].fullText).toContain("Image: mug_side.png");
    expect(enriched[0].fullText).toContain("Prompt: Describe the render");
    expect(enriched[0].imageSource).toBe("/api/media?path=%2Ftmp%2Fmug_side.png");
  });

  test("consecutive image views fold into a 'Viewed N images' group that reveals each thumbnail", () => {
    const entries = groupSharedActivities([
      { id: "1", phase: "result", text: "Viewed an image", toolName: "image" },
      { id: "2", phase: "result", text: "Viewed an image", toolName: "image" },
      { id: "3", phase: "result", text: "Viewed an image", toolName: "image" },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "group", kind: "view", label: "Viewed 3 images" });
    expect((entries[0] as { items: unknown[] }).items).toHaveLength(3);
    expect(
      groupSharedActivities([
        { id: "1", phase: "result", text: "Ran pwd", toolName: "exec" },
        { id: "2", phase: "result", text: "Ran echo hi", toolName: "exec" },
        { id: "3", phase: "result", text: "Viewed an image", toolName: "image" },
        { id: "4", phase: "result", text: "Viewed an image", toolName: "image" },
      ]).map((entry) => (entry.type === "group" ? entry.label : "single"))
    ).toEqual(["Ran 2 commands", "Viewed 2 images"]);
  });

  test("live activity ids match the gateway's runId:sequence scheme so rows survive completion", () => {
    const started = applyLiveActivityEvent([], {
      phase: "start",
      text: "Viewing an image",
      timestamp: 1_000,
      toolName: "image",
      toolCallId: "chatcmpl-tool-1",
      runId: "run-abc",
      sequence: 7,
    });
    expect(started[0].id).toBe("run-abc:7");
    const completed = applyLiveActivityEvent(started, {
      phase: "result",
      text: "Viewed an image",
      timestamp: 2_000,
      toolName: "image",
      toolCallId: "chatcmpl-tool-1",
      imageSource: "/api/media?path=%2Ftmp%2Fa.png",
      runId: "run-abc",
      sequence: 8,
    });
    expect(completed).toHaveLength(1);
    expect(completed[0].id).toBe("run-abc:7");
    expect(completed[0].imageSource).toBe("/api/media?path=%2Ftmp%2Fa.png");
    const fallback = applyLiveActivityEvent([], {
      phase: "result",
      text: "Ran ls",
      toolName: "exec",
    });
    expect(fallback[0].id).toMatch(/^\d+-[a-z0-9]{6}$/);
  });

  test("image views stay standalone rows instead of folding into command groups", () => {
    const entries = groupSharedActivities([
      { id: "1", phase: "result", text: "Ran ls", toolName: "exec" },
      { id: "2", phase: "result", text: "Viewed an image", toolName: "image" },
      { id: "3", phase: "result", text: "Ran pwd", toolName: "exec" },
    ]);
    expect(entries.map((entry) => entry.type)).toEqual(["single", "single", "single"]);
    expect(entries[1]).toEqual({
      type: "single",
      activity: { id: "2", phase: "result", text: "Viewed an image", toolName: "image" },
    });
  });

  test("timeline reveals the thumbnail only once the row is expanded", () => {
    const timelineSource = readFileSync(
      fileURLToPath(new URL("../../ui/src/pages/chat/ActivityTimeline.tsx", import.meta.url)),
      "utf8"
    );
    expect(timelineSource).toContain("expanded && activity.imageSource");
    expect(timelineSource).toContain('data-testid="activity-image-viewed-preview"');
    expect(timelineSource).toContain("const hasImage = Boolean(activity.imageSource);");
    expect(timelineSource).toContain('data-testid="activity-image-icon"');
    expect(timelineSource).toContain("expanded && activity.imageSource");
    expect(timelineSource).toContain('data-testid="activity-image-viewed-strip"');
    expect(timelineSource).toContain('expanded && entry.kind === "view" ? (');
    expect(timelineSource).not.toContain("revealImage");
    expect(timelineSource).toContain("view: ImageIcon");
    expect(timelineSource).toContain(
      'const LIVE_OPEN_GROUP_KINDS: readonly ActivityGroupKind[] = ["view"];'
    );
    expect(timelineSource).toContain("openByDefault={LIVE_OPEN_GROUP_KINDS}");
    expect(timelineSource).toContain(
      "const expanded = openByDefault.includes(entry.kind) !== toggledGroups.has(entry.id);"
    );
    expect(timelineSource).toContain("peekChatImageSource(source) ?? null");
    expect(timelineSource).toContain('activity.phase === "result" && hasImage ? (');
  });
});

describe("ide activity labels", () => {
  test("labels image views instead of falling back to the tool name", () => {
    expect(formatIdeStatusEventText("image", "start")).toBe("Viewing an image");
    expect(formatIdeStatusEventText("image", "result")).toBe("Viewed an image");
    expect(formatIdeStatusEventText("image", "result", "image complete")).toBe("Viewed an image");
    expect(formatIdeStatusEventText("exec", "result", "Ran ls")).toBe("Ran ls");
    expect(formatIdeStatusEventText("exec", "result")).toBe("exec complete");
  });
});
