import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("responsive layout contracts", () => {
  test("dashboard has a direct route for deep links and audits", () => {
    const appSource = read("ui/src/App.tsx");

    expect(appSource).toContain('<Route path="/" element={<Dashboard />} />');
    expect(appSource).toContain('<Route path="/dashboard" element={<Dashboard />} />');
  });

  test("shared page headers and task actions wrap on narrow screens", () => {
    const pageLayoutSource = read("ui/src/components/layout/PageLayout.tsx");
    const tasksSource = read("ui/src/pages/Tasks.tsx");

    expect(pageLayoutSource).toContain("flex flex-wrap items-center justify-between");
    expect(pageLayoutSource).toContain("max-md:pr-14");
    expect(pageLayoutSource).toContain("max-sm:w-full sm:justify-end");
    expect(tasksSource).toContain("grid w-full grid-cols-2 gap-2");
    expect(tasksSource).toContain("lg:flex-row lg:items-start lg:justify-between");
    expect(tasksSource).toContain('className="w-full sm:w-auto"');
  });

  test("IDE uses a single-pane composition on mobile", () => {
    const ideSource = read("ui/src/pages/IDE.tsx");

    expect(ideSource).toContain("max-md:h-[calc(100vh-3.5rem)]");
    expect(ideSource).toContain("max-md:pr-14");
    expect(ideSource).toContain("hidden items-center gap-1 relative md:flex");
    expect(ideSource).toContain("relative md:flex");
    expect(ideSource).toContain("hidden h-full w-1.5");
    expect(ideSource).toContain("hidden border-l border-white/10");
    expect(ideSource).toContain("hidden text-gray-600 md:inline");
    expect(ideSource).toContain("hidden md:block");
    expect(ideSource).toContain('<span className="max-md:hidden">Terminal</span>');
    expect(ideSource).toContain('<span className="max-md:hidden">Chat</span>');
    expect(ideSource).toContain('<span className="max-md:hidden">Settings</span>');
  });
});
