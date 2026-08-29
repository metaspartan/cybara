import { describe, expect, test } from "bun:test";
import { classifyApiRequestError } from "../../src/api/request-error";

describe("API request error classification", () => {
  test("preserves existing public error contracts for deferred routes", () => {
    expect(classifyApiRequestError("No API credentials available")).toEqual({
      userMessage: "API credentials not configured. Please add a provider with valid API keys.",
      errorCode: "MISSING_CREDENTIALS",
      statusCode: 400,
    });
    expect(classifyApiRequestError("Rate limit reached").statusCode).toBe(429);
    expect(classifyApiRequestError("Agent is not running").statusCode).toBe(409);
    expect(classifyApiRequestError("Validation error: message required").statusCode).toBe(400);
    expect(classifyApiRequestError("unexpected")).toEqual({
      userMessage: "An error occurred while processing your request.",
      errorCode: "INTERNAL_ERROR",
      statusCode: 500,
    });
  });
});
