import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildActivitiesFromToolCalls,
  enrichActivitiesWithToolCallDetails,
  imageViewedSource,
  type LiveActivityItem,
} from "../../ui/src/lib/chatActivities";
import { onOpenChatImageLightbox, openChatImageLightbox } from "../../ui/src/lib/chatImageLightbox";

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
