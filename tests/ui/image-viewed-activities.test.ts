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
} from "../../ui/src/lib/chatActivities";
import { onOpenChatImageLightbox, openChatImageLightbox } from "../../ui/src/lib/chatImageLightbox";
import { formatToolIntent } from "../../ui/src/pages/chat/chatModel";

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
    expect(timelineSource).toContain('activity.phase === "result" && hasImage ? (');
  });
});
