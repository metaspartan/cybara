import { describe, expect, test } from "bun:test";
import { withJsonRequestHeaders } from "./api-client";

describe("withJsonRequestHeaders", () => {
  test("adds the JSON content type while preserving caller headers", () => {
    const options = withJsonRequestHeaders({ headers: { "If-Match": "revision-1" } });
    const headers = new Headers(options.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("If-Match")).toBe("revision-1");
  });

  test("preserves an explicit caller content type", () => {
    const options = withJsonRequestHeaders({
      headers: new Headers({ "Content-Type": "application/octet-stream" }),
    });
    expect(new Headers(options.headers).get("Content-Type")).toBe("application/octet-stream");
  });
});
