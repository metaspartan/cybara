import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildPendingInlinePreviewRows,
  countGitDiffLineChanges,
  mergeGitDiffDecorations,
  parseGitDiffDecorations,
} from "../../ui/src/lib/idePendingDiffDecorations";

const ideSourcePath = fileURLToPath(new URL("../../ui/src/pages/IDE.tsx", import.meta.url));

function readIdeSource(): string {
  return readFileSync(ideSourcePath, "utf8");
}

describe("IDE editor pending diff highlighting", () => {
  test("anchors replacements as mixed current-file lines and preserves deleted snippets", () => {
    const diff = [
      "@@ -23,2 +23,2 @@",
      '-DATABASE_PATH: z.string().default("./data/gitzilla.db"),',
      '+DATABASE_URL: z.string().default("postgres://gitzilla:gitzilla@localhost:5432/gitzilla"),',
      ' REDIS_URL: z.string().default("redis://localhost:6379"),',
    ].join("\n");

    const decorations = parseGitDiffDecorations(diff, 40);

    expect(decorations.lineStates.get(23)).toBe("mixed");
    expect(decorations.deletedBlocks).toEqual([
      {
        anchorLine: 23,
        lines: ['DATABASE_PATH: z.string().default("./data/gitzilla.db"),'],
      },
    ]);
  });

  test("clamps trailing deletions to the last visible line and merges multi-file decorations", () => {
    const merged = mergeGitDiffDecorations(
      [
        ["@@ -7,2 +7,0 @@", "-tail_cleanup()", "-close_connection()"].join("\n"),
        ["@@ -2,0 +2,1 @@", '+const ready = true;'].join("\n"),
      ],
      6
    );

    expect(merged.lineStates.get(2)).toBe("added");
    expect(merged.lineStates.get(6)).toBe("removed");
    expect(merged.deletedBlocks).toEqual([
      {
        anchorLine: 6,
        lines: ["tail_cleanup()", "close_connection()"],
      },
    ]);
  });

  test("counts added and removed unified diff lines for hydration fallbacks", () => {
    const counts = countGitDiffLineChanges(
      [
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1,3 +1,3 @@",
        "-old title",
        "+new title",
        " unchanged",
      ].join("\n")
    );

    expect(counts).toEqual({
      added: 1,
      removed: 1,
      truncated: false,
    });
  });

  test("builds inline preview rows for multi-line replacements without collapsing removed lines", () => {
    const rows = buildPendingInlinePreviewRows(
      [
        "@@ -1,4 +1,4 @@",
        " <p align=\"center\">",
        '-  <img src="https://img.shields.io/badge/tools-50-green" alt="50 Tools" />',
        '-  <img src="https://img.shields.io/badge/providers-31-purple" alt="31 Providers" />',
        '+  <img src="https://img.shields.io/badge/tools-53-green" alt="53 Tools" />',
        '+  <img src="https://img.shields.io/badge/providers-33-purple" alt="33 Providers" />',
        " </p>",
      ].join("\n"),
      [
        "<p align=\"center\">",
        '  <img src="https://img.shields.io/badge/tools-53-green" alt="53 Tools" />',
        '  <img src="https://img.shields.io/badge/providers-33-purple" alt="33 Providers" />',
        "</p>",
      ].join("\n")
    );

    expect(rows).toEqual([
      {
        kind: "context",
        lineNumber: 1,
        text: '<p align="center">',
      },
      {
        kind: "removed",
        lineNumber: null,
        text: '  <img src="https://img.shields.io/badge/tools-50-green" alt="50 Tools" />',
      },
      {
        kind: "removed",
        lineNumber: null,
        text: '  <img src="https://img.shields.io/badge/providers-31-purple" alt="31 Providers" />',
      },
      {
        kind: "added",
        lineNumber: 2,
        text: '  <img src="https://img.shields.io/badge/tools-53-green" alt="53 Tools" />',
      },
      {
        kind: "added",
        lineNumber: 3,
        text: '  <img src="https://img.shields.io/badge/providers-33-purple" alt="33 Providers" />',
      },
      {
        kind: "context",
        lineNumber: 4,
        text: "</p>",
      },
    ]);
  });

  test("renders pending diff line states, floating approval controls, and hides the title badge", () => {
    const source = readIdeSource();

    expect(source).toContain(
      "const [pendingLineDecorations, setPendingLineDecorations] = useState<IdePendingDiffDecorations>"
    );
    expect(source).toContain("const [pendingPreviewDiff, setPendingPreviewDiff] = useState<string | null>(null);");
    expect(source).toContain("mergeGitDiffDecorations(");
    expect(source).toContain("parseGitDiffDecorations(");
    expect(source).toContain("buildPendingInlinePreviewRows(pendingPreviewDiff, sourceText)");
    expect(source).toContain("const selectPendingPreviewLine = useCallback(");
    expect(source).toContain("selectPendingPreviewLine(requestedLine, { scrollIntoView: true });");
    expect(source).toContain("selectPendingPreviewLine(row.lineNumber, {");
    expect(source).toContain("const wasShowingPendingPreview = previousPendingInlinePreviewRef.current;");
    expect(source).toContain("textarea.setSelectionRange(offset, offset);");
    expect(source).toContain("textarea.scrollTop = scrollMetrics.top;");
    expect(source).toContain("pendingLineDecorations.lineStates.get(i + 1)");
    expect(source).toContain("getPendingLineDecorationStyle(pendingLineState, isActiveLine)");
    expect(source).toContain("ref={previewScrollRef}");
    expect(source).toContain("Removed line");
    expect(source).toContain("border border-red-500/25 bg-red-500/10");
    expect(source).toContain("setPendingLineDecorations(emptyIdePendingDiffDecorations());");
    expect(source).toContain("onPendingFileDiffControllerChange={setIdePendingFileDiffController}");
    expect(source).toContain("Accept Changes");
    expect(source).toContain("Reject Changes");
    expect(source).toContain("File {activePendingEditorFileIndex + 1} of {pendingEditorFiles.length}");
    expect(source).toContain("enableCompletions={false}");
    expect(source).toContain("enableGhostCompletions={false}");
    expect(source).not.toContain('id: "completion"');
    expect(source).not.toContain('ideSettingsSection === "completion"');
    expect(source).not.toContain("{pendingMessageChangeKeys.length} pending");
  });
});
