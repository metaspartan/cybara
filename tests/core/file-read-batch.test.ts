import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleRead } from "../../src/core/tools/handlers/file";
import { executeTool } from "../../src/core/tools/handlers";
import { config } from "../../src/core/config";
import { readBatchInOrder } from "../../src/core/tools/read-batch";

let root = "";
let outside = "";
let oldEditMode: unknown;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cybara-batch-read-"));
  outside = mkdtempSync(join(tmpdir(), "cybara-batch-outside-"));
  oldEditMode = config.get("edit_tool_mode");
  config.set("edit_tool_mode", "replace");
});
afterEach(() => {
  config.set("edit_tool_mode", oldEditMode ?? "replace");
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("bounded ordered read arrays", () => {
  for (const count of [1, 3, 4, 5, 8])
    test(`returns exact contents and order for ${count} files`, async () => {
      const paths = Array.from({ length: count }, (_, index) => join(root, `${index}.json`));
      for (const [index, path] of paths.entries())
        writeFileSync(path, `{ "index": ${index}, "text": "quote \\\" and \\t space" }`);
      const result = await handleRead(
        { path: paths },
        { workspaceDir: root, confineToWorkspace: true }
      );
      if (!("files" in result)) throw new Error("Batch result missing");
      expect(result.files.map((file) => file.path)).toEqual(paths);
      expect(result.files.map((file) => file.error)).toEqual(paths.map(() => undefined));
      expect(result.files.map((file) => file.content)).toEqual(
        paths.map((_, index) => `{ "index": ${index}, "text": "quote \\\" and \\t space" }`)
      );
    });

  test("rejects malformed arrays and the smallest size above the limit", async () => {
    for (const paths of [
      [],
      [null],
      [""],
      [" "],
      Array.from({ length: 9 }, () => join(root, "file")),
    ])
      await expect(handleRead({ path: paths })).rejects.toThrow("1 to 8");
  });

  test("keeps allowed results alongside denied and missing inputs without reading secrets", async () => {
    const allowed = join(root, "allowed.txt");
    const secret = join(outside, "private.txt");
    writeFileSync(allowed, "allowed content");
    writeFileSync(secret, "OUTSIDE-SECRET");
    const result = await handleRead(
      { path: [allowed, secret, join(root, "missing.txt")] },
      { workspaceDir: root, confineToWorkspace: true }
    );
    if (!("files" in result)) throw new Error("Batch result missing");
    expect(result.files[0]?.content).toBe("allowed content");
    expect(result.files[1]?.error).toBeTruthy();
    expect(result.files[2]?.error).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain("OUTSIDE-SECRET");
  });

  test("rejects symlink escapes and batch vision while single path reads retain their contract", async () => {
    const directory = join(root, "linked");
    symlinkSync(outside, directory, process.platform === "win32" ? "junction" : "dir");
    writeFileSync(join(outside, "private.txt"), "SYMLINK-SECRET");
    writeFileSync(join(root, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await handleRead(
      { path: [join(directory, "private.txt"), join(root, "image.png")] },
      { workspaceDir: root, confineToWorkspace: true }
    );
    if (!("files" in result)) throw new Error("Batch result missing");
    expect(result.files[0]?.error).toBeTruthy();
    expect(result.files[1]?.error).toBe("Use a single path to view an image");
    expect(JSON.stringify(result)).not.toContain("SYMLINK-SECRET");
    writeFileSync(join(root, "one.txt"), "one\ntwo\nthree");
    expect(await handleRead({ path: join(root, "one.txt"), offset: 2, limit: 1 })).toEqual({
      path: join(root, "one.txt"),
      content: "two",
    });
  });

  test("normalizes every relative path through the actual tool dispatcher", async () => {
    writeFileSync(join(root, "first.txt"), "first");
    writeFileSync(join(root, "second.txt"), "second");
    const result = await executeTool(
      "read",
      { path: ["second.txt", "first.txt"] },
      { workspaceDir: root, confineToWorkspace: true, allowedToolNames: ["read"] }
    );
    expect(result).toEqual({
      files: [
        { path: join(root, "second.txt"), content: "second" },
        { path: join(root, "first.txt"), content: "first" },
      ],
    });
  });

  test("bounded output reports explicit truncation or recovery errors", async () => {
    const paths = [join(root, "a.txt"), join(root, "b.txt")];
    for (const path of paths) writeFileSync(path, "x".repeat(1_100_000));
    const result = await handleRead(
      { path: paths },
      { workspaceDir: root, confineToWorkspace: true }
    );
    if (!("files" in result)) throw new Error("Batch result missing");
    expect(
      result.files.every((file) => Boolean(file.error) || file.content?.includes("[Read truncated"))
    ).toBe(true);
    expect(
      result.files.reduce((sum, file) => sum + (file.content?.length ?? 0), 0)
    ).toBeLessThanOrEqual(2_000_000);
  });
});

for (const count of [3, 4, 5])
  test(`read concurrency starts exactly ${Math.min(4, count)} jobs at the boundary ${count}`, async () => {
    const input = Array.from({ length: count }, (_, index) => index);
    const gates = input.map(() => Promise.withResolvers<void>());
    let active = 0;
    let maxActive = 0;
    let completed = 0;
    const started: number[] = [];
    const work = readBatchInOrder(input, async (index) => {
      started.push(index);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gates[index]?.promise;
      active -= 1;
      completed += 1;
      return index;
    });
    await Bun.sleep(0);
    expect(started).toEqual(input.slice(0, 4));
    for (const gate of gates.slice(0, 4)) gate.resolve();
    await Bun.sleep(0);
    if (count > 4) {
      expect(started).toEqual(input);
      gates[4]?.resolve();
    }
    expect(await work).toEqual(input);
    expect(maxActive).toBe(Math.min(4, count));
    expect(active).toBe(0);
    expect(completed).toBe(count);
  });

test("batch cancellation cleans started jobs and does not start a fifth read", async () => {
  const controller = new AbortController();
  const gate = Promise.withResolvers<void>();
  let started = 0;
  let finished = 0;
  const work = readBatchInOrder(
    [0, 1, 2, 3, 4],
    async (value) => {
      started += 1;
      await gate.promise;
      finished += 1;
      return value;
    },
    controller.signal
  );
  await Bun.sleep(0);
  controller.abort();
  gate.resolve();
  await expect(work).rejects.toThrow("cancelled");
  expect(started).toBe(4);
  expect(finished).toBe(4);
});
