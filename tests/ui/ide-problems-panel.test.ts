import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();

describe("IDE Problems and LSP recovery", () => {
  test("exposes workspace diagnostics as navigable editor problems", () => {
    const view = readFileSync(join(root, "ui/src/pages/ide/IDEView.tsx"), "utf8");
    const panel = readFileSync(join(root, "ui/src/pages/ide/IDEProblemsPanel.tsx"), "utf8");

    expect(view).toContain('setSidebarMode("problems")');
    expect(view).toContain("<IDEProblemsPanel");
    expect(panel).toContain("/api/lsp/diagnostics?path=");
    expect(panel).toContain("onOpenLocation(issue.file, issue.line + 1)");
    expect(panel).toContain("requestSequenceRef.current");
    expect(panel).toContain("content-visibility:auto");
    expect(panel).toContain('file.replace(/\\\\/g, "/")');
  });

  test("keeps status fresh and lets users restart stale workspace servers", () => {
    const status = readFileSync(join(root, "ui/src/pages/ide/LSPStatus.tsx"), "utf8");
    const routes = readFileSync(join(root, "src/api/routes/ide-lsp-routes.ts"), "utf8");

    expect(status).toContain("/api/lsp/restart?path=");
    expect(status).toContain('window.addEventListener("focus", refreshWhenVisible)');
    expect(routes).toContain('"POST /api/lsp/restart"');
  });
});
