import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { config } from "../../src/core/config";
import { validateToolArguments } from "../../src/core/tool-argument-validation";
import { getMissingRequiredToolArguments } from "../../src/core/tools/handlers";
import { handleEdit, handleRead } from "../../src/core/tools/handlers/file";
import {
  applyHashlineEdits,
  formatHashlines,
  lineAnchor,
  lineHash,
} from "../../src/core/tools/handlers/hashline";
import { getEffectiveToolSchema, getToolSchemasForLLM } from "../../src/core/tools/registry";

const roots: string[] = [];
afterEach(() => {
  config.setEditToolMode("replace");
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "cybara-hashline-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  return { root, context: { agentId: "test", workspaceDir: root, confineToWorkspace: true } };
}

const SOURCE = [
  "def total(items):",
  "    result = 0",
  "    for item in items:",
  "        result += item",
  "    return result",
  "",
].join("\n");
const lines = SOURCE.split("\n").slice(0, -1);
const at = (n: number) => lineAnchor(n, lines[n - 1]);

describe("hashline anchors", () => {
  test("hashes are short, stable, and sensitive to whitespace", () => {
    expect(lineHash("    return result")).toMatch(/^[0-9a-z]{3}$/);
    expect(lineHash("    return result")).toBe(lineHash("    return result"));
    expect(lineHash("    return result")).not.toBe(lineHash("  return result"));
    expect(formatHashlines(["a", "b"], 7)).toBe(`${lineAnchor(7, "a")}|a\n${lineAnchor(8, "b")}|b`);
  });

  test("replaces, deletes, and inserts in one call while preserving the trailing newline", () => {
    const result = applyHashlineEdits(SOURCE, [
      { op: "replace", start: at(2), content: "    result = 1" },
      { op: "delete", start: at(4) },
      { op: "insert_after", start: at(3), content: "        result *= item" },
      { op: "insert_before", start: at(1), content: "# product" },
    ]);
    expect(result.content).toBe(
      [
        "# product",
        "def total(items):",
        "    result = 1",
        "    for item in items:",
        "        result *= item",
        "    return result",
        "",
      ].join("\n")
    );
    expect(result.changedRegions[0]).toContain("|        result *= item");
  });

  test("replacing a range keeps line endings and accepts multi-line content", () => {
    const crlf = "a\r\nb\r\nc\r\n";
    const result = applyHashlineEdits(crlf, [
      { op: "replace", start: lineAnchor(1, "a"), end: lineAnchor(2, "b"), content: "x\ny\nz" },
    ]);
    expect(result.content).toBe("x\r\ny\r\nz\r\nc\r\n");
  });

  test("stale anchors are rejected with current anchors and nothing changes", () => {
    const edited = SOURCE.replace("result = 0", "result = 5");
    expect(() =>
      applyHashlineEdits(edited, [{ op: "replace", start: at(2), content: "x" }])
    ).toThrow(
      /Stale anchor .* changed since it was read\. Nothing was edited\. Current lines:\n[\s\S]*2#[0-9a-z]{3}\|    result = 5/
    );
    expect(() => applyHashlineEdits(SOURCE, [{ op: "delete", start: "99#abc" }])).toThrow(
      "the file has 5 lines"
    );
    expect(() => applyHashlineEdits(SOURCE, [{ op: "delete", start: "line 2" }])).toThrow(
      "not a line anchor"
    );
  });

  test("tolerates pasted read lines, shifted line numbers, and bare unique line text", () => {
    const expected = SOURCE.replace("    result = 0", "    result = 1");
    const edit = (start: string) =>
      applyHashlineEdits(SOURCE, [{ op: "replace", start, content: "    result = 1" }]).content;
    expect(edit(`${at(2)}|    result = 0`)).toBe(expected);
    expect(edit(`${at(2).replace("#", " # ")}`)).toBe(expected);
    expect(edit(`3#${lineHash("    result = 0")}`)).toBe(expected);
    expect(edit("    result = 0")).toBe(expected);
    expect(edit("2#zz|    result = 0")).toBe(expected);
    expect(() => edit("")).toThrow("not a line anchor");
    const duplicated = "x = 1\ny = 2\nx = 1\n";
    expect(() => applyHashlineEdits(duplicated, [{ op: "delete", start: "x = 1" }])).toThrow(
      "not a line anchor"
    );
  });

  test("overlapping edits and inserts inside a replaced range are rejected", () => {
    expect(() =>
      applyHashlineEdits(SOURCE, [
        { op: "replace", start: at(2), end: at(4), content: "x" },
        { op: "delete", start: at(3) },
      ])
    ).toThrow("edits overlap");
    expect(() =>
      applyHashlineEdits(SOURCE, [
        { op: "replace", start: at(2), end: at(4), content: "x" },
        { op: "insert_after", start: at(2), content: "y" },
      ])
    ).toThrow("insert falls inside a range");
    expect(
      applyHashlineEdits(SOURCE, [
        { op: "replace", start: at(2), end: at(3), content: "x" },
        { op: "insert_after", start: at(3), content: "y" },
      ])
        .content.split("\n")
        .slice(1, 4)
    ).toEqual(["x", "y", "        result += item"]);
  });
});

describe("edit tool modes", () => {
  test("hashline mode swaps the edit schema, anchors reads, and validates against the new schema", async () => {
    config.setEditToolMode("hashline");
    const edit = getToolSchemasForLLM().find((tool) => tool.name === "edit");
    expect((edit?.input_schema as { required: string[] }).required).toEqual(["path"]);
    expect(getEffectiveToolSchema("read")?.description).toContain("LINE#HASH|content");
    expect(getMissingRequiredToolArguments("edit", { path: "a.py", edits: [] })).toEqual([]);

    const { root, context } = workspace({ "calc.py": SOURCE });
    const read = await handleRead({ path: join(root, "calc.py"), offset: 3, limit: 2 }, context);
    expect(read.content).toBe(formatHashlines(lines.slice(2, 4), 3));
    const result = await handleEdit(
      {
        path: join(root, "calc.py"),
        edits: [{ op: "replace", start: at(2), content: "    result = 1" }],
      },
      context
    );
    expect(readFileSync(join(root, "calc.py"), "utf8")).toContain("    result = 1\n");
    expect(result.anchors?.[0]).toContain("|    result = 1");
  });

  test("hashline mode still accepts oldText and newText edits", async () => {
    config.setEditToolMode("hashline");
    expect(
      getMissingRequiredToolArguments("edit", { path: "a.py", oldText: "a", newText: "b" })
    ).toEqual([]);
    expect(
      validateToolArguments(
        { path: "a.py", oldText: "a", newText: "b" },
        getEffectiveToolSchema("edit")?.input_schema
      )
    ).toEqual([]);
    const { root, context } = workspace({ "calc.py": SOURCE });
    await handleEdit(
      { path: join(root, "calc.py"), oldText: "result = 0", newText: "result = 2" },
      context
    );
    expect(readFileSync(join(root, "calc.py"), "utf8")).toContain("    result = 2\n");
    await expect(handleEdit({ path: join(root, "calc.py") }, context)).rejects.toThrow(
      "provide edits with line anchors from read output, or oldText and newText"
    );
  });

  test("replace mode is the default and keeps its schema", () => {
    const edit = getToolSchemasForLLM().find((tool) => tool.name === "edit");
    expect((edit?.input_schema as { required: string[] }).required).toEqual([
      "path",
      "oldText",
      "newText",
    ]);
  });

  test("replace mode inserts text literally, even with $ patterns", async () => {
    const { root, context } = workspace({ "run.sh": "echo placeholder\n" });
    await handleEdit(
      { path: join(root, "run.sh"), oldText: "placeholder", newText: 'cost $& and $1 and "$HOME"' },
      context
    );
    expect(readFileSync(join(root, "run.sh"), "utf8")).toBe('echo cost $& and $1 and "$HOME"\n');
  });

  test("replace mode refuses ambiguous matches and hints at whitespace mismatches", async () => {
    const { root, context } = workspace({
      "a.py": "x = 1\nx = 1\n",
      "b.py": "if ok:\n        return  value\n",
    });
    await expect(
      handleEdit({ path: join(root, "a.py"), oldText: "x = 1", newText: "x = 2" }, context)
    ).rejects.toThrow("matches 2 places");
    expect(readFileSync(join(root, "a.py"), "utf8")).toBe("x = 1\nx = 1\n");
    await expect(
      handleEdit(
        { path: join(root, "b.py"), oldText: "    return value", newText: "return 0" },
        context
      )
    ).rejects.toThrow("different whitespace is at line 2");
  });
});
