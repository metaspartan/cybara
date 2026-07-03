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
const codeViewerSourcePath = fileURLToPath(
  new URL("../../ui/src/pages/ide/CodeViewer.tsx", import.meta.url)
);
const ideChatPanelSourcePath = fileURLToPath(
  new URL("../../ui/src/pages/ide/IDEChatPanel.tsx", import.meta.url)
);

function readIdeSource(): string {
  return readFileSync(ideSourcePath, "utf8");
}

function readCodeViewerSource(): string {
  return readFileSync(codeViewerSourcePath, "utf8");
}

function readIdeChatPanelSource(): string {
  return readFileSync(ideChatPanelSourcePath, "utf8");
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
        ["@@ -2,0 +2,1 @@", "+const ready = true;"].join("\n"),
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
        ' <p align="center">',
        '-  <img src="https://img.shields.io/badge/tools-50-green" alt="50 Tools" />',
        '-  <img src="https://img.shields.io/badge/providers-31-purple" alt="31 Providers" />',
        '+  <img src="https://img.shields.io/badge/tools-53-green" alt="53 Tools" />',
        '+  <img src="https://img.shields.io/badge/providers-33-purple" alt="33 Providers" />',
        " </p>",
      ].join("\n"),
      [
        '<p align="center">',
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
    const ideSource = readIdeSource();
    const codeViewerSource = readCodeViewerSource();
    const ideChatPanelSource = readIdeChatPanelSource();

    expect(codeViewerSource).toMatch(
      /const \[pendingLineDecorations, setPendingLineDecorations\] =\s*useState<IdePendingDiffDecorations>/
    );
    expect(codeViewerSource).toContain(
      "const [pendingPreviewDiff, setPendingPreviewDiff] = useState<string | null>(null);"
    );
    expect(codeViewerSource).toContain("mergeGitDiffDecorations(");
    expect(codeViewerSource).toContain("parseGitDiffDecorations(");
    expect(codeViewerSource).toMatch(
      /buildPendingInlinePreviewRows\(\s*pendingPreviewDiff,\s*sourceText\s*\)/
    );
    expect(codeViewerSource).toContain("const selectPendingPreviewLine = useCallback(");
    expect(codeViewerSource).toMatch(
      /selectPendingPreviewLine\(\s*requestedLine,\s*\{\s*scrollIntoView: true\s*\}\s*\);/
    );
    expect(codeViewerSource).toMatch(/selectPendingPreviewLine\(\s*row\.lineNumber,\s*\{/);
    expect(codeViewerSource).toContain(
      "const wasShowingPendingPreview = previousPendingInlinePreviewRef.current;"
    );
    expect(codeViewerSource).toContain("textarea.setSelectionRange(offset, offset);");
    expect(codeViewerSource).toContain("textarea.scrollTop = scrollMetrics.top;");
    expect(codeViewerSource).toContain("pendingLineDecorations.lineStates.get(i + 1)");
    expect(codeViewerSource).toMatch(
      /getPendingLineDecorationStyle\(\s*pendingLineState,\s*isActiveLine\s*\)/
    );
    expect(codeViewerSource).toContain("ref={previewScrollRef}");
    expect(codeViewerSource).toContain("Removed line");
    expect(codeViewerSource).toContain("border border-red-500/25 bg-red-500/10");
    expect(codeViewerSource).toContain(
      "setPendingLineDecorations(emptyIdePendingDiffDecorations());"
    );
    expect(ideChatPanelSource).toMatch(/onPendingFileDiffControllerChange\?\.\(\s*\{/);
    expect(ideSource).toMatch(
      /onPendingFileDiffControllerChange=\{setIdePendingFileDiffController\}/
    );
    expect(ideSource).toContain("Accept Changes");
    expect(ideSource).toContain("Reject Changes");
    expect(ideSource).toMatch(
      /File \{activePendingEditorFileIndex \+ 1\} of \{pendingEditorFiles\.length\}/
    );
    expect(ideSource).toContain("enableCompletions={false}");
    expect(ideSource).toContain("enableGhostCompletions={false}");
    expect(ideSource).not.toContain('id: "completion"');
    expect(ideSource).not.toContain('ideSettingsSection === "completion"');
    expect(ideSource).not.toContain("{pendingMessageChangeKeys.length} pending");
  });
});
