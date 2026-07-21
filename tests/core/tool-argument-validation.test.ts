import { describe, expect, test } from "bun:test";
import { validateToolArguments } from "../../src/core/tool-argument-validation";

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["open", "close"] },
    timeout: { type: "integer", minimum: 1, maximum: 30 },
    coordinates: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "number" },
    },
    target: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", minLength: 1 } },
    },
  },
};

describe("tool argument validation", () => {
  test("accepts arguments that satisfy the runtime schema", () => {
    expect(
      validateToolArguments({ action: "open", timeout: 10, coordinates: [1, 2] }, schema)
    ).toEqual([]);
  });

  test("rejects invalid enum, type, range, and extra values", () => {
    const errors = validateToolArguments(
      { action: "delete", timeout: 31.5, coordinates: [1, "2", 3], extra: true },
      schema
    );
    expect(errors.join("\n")).toContain("arguments.action must be one of open, close");
    expect(errors.join("\n")).toContain("arguments.timeout must be integer");
    expect(errors.join("\n")).toContain("arguments.coordinates must contain at most 2 items");
    expect(errors.join("\n")).toContain("arguments.coordinates[1] must be number");
    expect(errors.join("\n")).toContain("arguments.extra is not allowed");
  });

  test("enforces nested requirements and schema composition", () => {
    expect(validateToolArguments({ target: {} }, schema)).toContain(
      "arguments.target.id is required"
    );
    expect(
      validateToolArguments("value", {
        oneOf: [{ type: "string" }, { type: ["string", "null"] }],
      })
    ).toContain("arguments must match exactly one allowed schema");
    expect(
      validateToolArguments(
        { label: "ok" },
        {
          type: "object",
          additionalProperties: { type: "string" },
        }
      )
    ).toEqual([]);
  });
});
