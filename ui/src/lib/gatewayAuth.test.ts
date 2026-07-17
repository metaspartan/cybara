import { describe, expect, test } from "bun:test";
import { checkGatewayAccess, type GatewayAccessFetcher } from "./gatewayAuth";

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("gateway browser authentication", () => {
  test("accepts an authenticated gateway response", async () => {
    let requestedPath = "";
    const fetcher: GatewayAccessFetcher = async (input) => {
      requestedPath = String(input);
      return jsonResponse(200, { success: true });
    };
    expect(await checkGatewayAccess(fetcher)).toEqual({ message: "", status: "ready" });
    expect(requestedPath).toBe("/api/info");
  });

  test("turns authorization failures into an unlock requirement", async () => {
    const fetcher: GatewayAccessFetcher = async () =>
      jsonResponse(401, { error: "Missing Authorization header" });
    expect(await checkGatewayAccess(fetcher)).toEqual({
      message: "Missing Authorization header",
      status: "required",
    });
  });

  test("keeps gateway failures distinct from rejected credentials", async () => {
    const fetcher: GatewayAccessFetcher = async () =>
      jsonResponse(503, { error: "Gateway is starting" });
    expect(await checkGatewayAccess(fetcher)).toEqual({
      message: "Gateway is starting",
      status: "unavailable",
    });
  });
});
