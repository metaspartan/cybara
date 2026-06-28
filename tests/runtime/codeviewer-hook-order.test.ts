import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const codeViewerSourcePath = fileURLToPath(
  new URL("../../ui/src/pages/ide/CodeViewer.tsx", import.meta.url)
);

function readCodeViewerSource(): string {
  return readFileSync(codeViewerSourcePath, "utf8");
}

function topLevelHookLinesAfter(source: string, marker: string): string[] {
  const markerIndex = source.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);

  return source
    .slice(markerIndex)
    .split("\n")
    .filter((line) =>
      /^  (?:const\s+[\w[\]{},\s]+\s*=\s*)?use(?:State|Ref|Effect|Memo|Callback|DeferredValue|Reducer|LayoutEffect|ImperativeHandle|Id)\b/.test(
        line
      )
    );
}

describe("CodeViewer hook order", () => {
  test("keeps every top-level React hook before conditional render returns", () => {
    const source = readCodeViewerSource();

    const firstConditionalRender = "  if (!path) {";
    expect(source).toContain(firstConditionalRender);
    expect(source).toContain("  if (isLoading && content === null) {");
    expect(source).toContain("  if (error) {");

    const lateHooks = topLevelHookLinesAfter(source, firstConditionalRender);
    expect(lateHooks).toEqual([]);
  });

  test("computes line diagnostics before loading, error, or empty-file render states", () => {
    const source = readCodeViewerSource();

    const diagnosticsHook = "  const lineDiagnostics = useMemo(() => {";
    const emptyState = "  if (!path) {";
    const loadingState = "  if (isLoading && content === null) {";
    const errorState = "  if (error) {";

    const diagnosticsIndex = source.indexOf(diagnosticsHook);
    expect(diagnosticsIndex).toBeGreaterThanOrEqual(0);
    expect(diagnosticsIndex).toBeLessThan(source.indexOf(emptyState));
    expect(diagnosticsIndex).toBeLessThan(source.indexOf(loadingState));
    expect(diagnosticsIndex).toBeLessThan(source.indexOf(errorState));
  });
});
