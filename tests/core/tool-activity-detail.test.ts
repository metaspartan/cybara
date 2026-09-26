import { describe, expect, test } from "bun:test";
import { formatToolActivityDetail } from "../../src/core/agent-internals";
import { fetchFailureLabel, fetchHttpStatusFromError } from "../../shared/tool-activity-detail";

describe("tool activity detail", () => {
  test("labels image reads as viewed images", () => {
    expect(formatToolActivityDetail("read", { path: "/Users/x/renders/side.png" }, "start")).toBe(
      "Viewing an image"
    );
    expect(formatToolActivityDetail("read", { path: "/Users/x/renders/side.png" }, "result")).toBe(
      "Viewed an image"
    );
    expect(formatToolActivityDetail("read", { path: "/Users/x/notes.md" }, "result")).toBe(
      "Explored /Users/x/notes.md"
    );
  });

  test("surfaces the HTTP status in fetch failure labels", () => {
    expect(
      formatToolActivityDetail(
        "web_fetch",
        { url: "https://bun.sh/docs/api/sleep" },
        "error",
        "Could not extract readable content from https://bun.sh/docs/api/sleep: direct: HTTP 404: Not Found"
      )
    ).toBe("Fetch failed (404) for https://bun.sh/docs/api/sleep");
    expect(
      formatToolActivityDetail(
        "web_fetch",
        { url: "https://example.com/api" },
        "error",
        "HTTP request failed: status 503"
      )
    ).toBe("Fetch failed (503) for https://example.com/api");
    expect(
      formatToolActivityDetail("web_fetch", { url: "https://example.com/api" }, "error", {
        error: "HTTP 403: Forbidden",
      })
    ).toBe("Fetch failed (403) for https://example.com/api");
  });

  test("keeps plain fetch failure labels when no status is available", () => {
    expect(
      formatToolActivityDetail(
        "web_fetch",
        { url: "https://example.com/api" },
        "error",
        "fetch failed: ECONNRESET"
      )
    ).toBe("Fetch failed for https://example.com/api");
    expect(formatToolActivityDetail("web_fetch", { url: "https://example.com/api" }, "error")).toBe(
      "Fetch failed for https://example.com/api"
    );
    expect(
      formatToolActivityDetail("web_fetch", { url: "https://example.com/api" }, "blocked", {
        error: "Refused: the host is not allowlisted",
      })
    ).toBe("Fetch blocked for https://example.com/api");
    expect(
      formatToolActivityDetail(
        "web_fetch",
        {},
        "error",
        "Could not extract readable content: HTTP 404"
      )
    ).toBe("Fetch failed (404)");
    expect(formatToolActivityDetail("web_fetch", {}, "error")).toBe("Fetch failed");
  });

  test("extracts fetch failure statuses from varied error shapes", () => {
    expect(fetchHttpStatusFromError("HTTP 429: Too Many Requests")).toBe("429");
    expect(fetchHttpStatusFromError({ error: "upstream returned status: 500" })).toBe("500");
    expect(fetchHttpStatusFromError({ message: "status code 502 from edge" })).toBe("502");
    expect(fetchHttpStatusFromError({ content: "request timed out" })).toBeUndefined();
    expect(fetchHttpStatusFromError(undefined)).toBeUndefined();
    expect(fetchHttpStatusFromError("HTTP/1.1 upgrade required")).toBeUndefined();
    expect(fetchFailureLabel("blocked", "https://example.com", "HTTP 404")).toBe(
      "Fetch blocked (404) for https://example.com"
    );
    expect(fetchFailureLabel("error", undefined, "boom")).toBe("Fetch failed");
  });

  test("identifies the loaded skill", () => {
    expect(
      formatToolActivityDetail("skill_load", { name: "security-scan" }, "result", {
        name: "Security Scan",
      })
    ).toBe("Loaded Security Scan skill");
  });

  test("identifies plan progress and the active item", () => {
    expect(
      formatToolActivityDetail(
        "todo",
        {
          items: [
            { content: "Inspect runtime", status: "completed" },
            { content: "Verify UI", status: "in_progress" },
          ],
        },
        "result"
      )
    ).toBe("Updated plan: Verify UI in progress (1/2 complete)");
  });
});
