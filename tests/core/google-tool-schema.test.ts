import { describe, expect, test } from "bun:test";
import { googleFunctionDeclaration } from "../../src/core/llm/google-tool-schema";

describe("google function declarations", () => {
  test("uses the typed parameters field for ordinary tool schemas", () => {
    const declaration = googleFunctionDeclaration({
      name: "read",
      description: "Read a file",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    });
    expect(declaration.parameters).toBeDefined();
    expect(declaration.parametersJsonSchema).toBeUndefined();
  });

  test("preserves dynamic argument maps through parametersJsonSchema", () => {
    const schema = {
      type: "object",
      properties: {
        arguments: { type: "object", additionalProperties: true },
      },
    };
    const declaration = googleFunctionDeclaration({
      name: "tool_call",
      description: "Call a tool",
      input_schema: schema,
    });
    expect(declaration.parameters).toBeUndefined();
    expect(declaration.parametersJsonSchema).toEqual(schema);
  });
});
