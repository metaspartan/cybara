import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("index.css design-system utilities", () => {
  const css = read("../../ui/src/index.css");

  test("defines the glass utilities that shared primitives reference", () => {
    // These were used by TextArea / GlassButton / GlassCard / Button but defined
    // nowhere, so those primitives rendered unstyled.
    expect(css).toContain(".glass-input");
    expect(css).toContain(".glass-button-primary");
    expect(css).toContain(".glass-card-hover");
    expect(css).toContain("@keyframes glow-pulse");
    expect(css).toContain(".glow-pulse");
    // They should be built on the accent token, not hardcoded colors.
    expect(css).toMatch(/\.glass-button-primary\s*\{[^}]*var\(--accent-primary\)/);
  });

  test("keyboard focus uses a visible accent outline, not the old 1px white ring", () => {
    expect(css).toMatch(
      /:focus-visible\s*\{\s*outline:\s*2px solid rgb\(var\(--accent-primary\)\)/
    );
    // The suppressive `outline: none !important` global rule is gone.
    expect(css).not.toContain("outline: none !important");
  });

  test("chat composer textarea opts out of the global input focus shadow", () => {
    expect(css).toContain('textarea[data-chat-composer-input="true"]:focus');
    expect(css).toContain('textarea[data-chat-composer-input="true"]:focus-visible');
    expect(css).toMatch(
      /textarea\[data-chat-composer-input="true"\]:focus,[\s\S]*?box-shadow:\s*none;/
    );
  });

  test("chat context ring and tooltip have light and dark theme tokens", () => {
    expect(css).toContain("--context-ring-ok");
    expect(css).toContain("--context-ring-warn");
    expect(css).toContain("--context-ring-danger");
    expect(css).toContain("--context-ring-track");
    expect(css).toContain("--context-ring-inner");
    expect(css).toContain("--context-tooltip-bg");
    expect(css).toContain(".context-usage-ring-fill");
    expect(css).toContain(".context-usage-tooltip");
    expect(css).toContain(".context-usage-tooltip-title");
    expect(css).toMatch(/html\.light\s*\{[\s\S]*--context-ring-ok:/);
    expect(css).toMatch(/html\.light\s*\{[\s\S]*--context-ring-track:/);
    expect(css).toMatch(/html\.light\s*\{[\s\S]*--context-tooltip-bg:/);
    expect(css).toMatch(
      /\.context-usage-tooltip\s*\{[\s\S]*background:\s*var\(--context-tooltip-bg\)/
    );
    expect(css).toMatch(
      /\.context-usage-ring-fill\s*\{[\s\S]*background:\s*var\(--context-ring-inner\)/
    );
  });

  test("honors prefers-reduced-motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("uses theme-aware neutral tokens for chat and workspace actions", () => {
    const chat =
      read("../../ui/src/pages/Chat.tsx") + read("../../ui/src/pages/chat/ChatMessageTimeline.tsx");
    const sessionSidebar = read("../../ui/src/pages/chat/SessionSidebar.tsx");

    expect(css).toContain("--icon-muted");
    expect(css).toContain("--icon-hover");
    expect(css).toMatch(/html\[data-theme-mode="sand-dune"\][\s\S]*--icon-muted:\s*#928777/);
    expect(css).toContain(".chat-message-action");
    expect(chat).toContain("chat-message-action");
    expect(sessionSidebar).toContain("theme-muted-icon-button");
    expect(sessionSidebar).toContain('Pin className="theme-muted-icon');
    expect(sessionSidebar).toContain('FolderOpen className="theme-muted-icon');
    expect(sessionSidebar).not.toContain('text-blue-300" />');
  });

  test("shared form controls and native select options use theme surface tokens", () => {
    const input = read("../../ui/src/components/ui/Input.tsx");
    const select = read("../../ui/src/components/ui/Select.tsx");
    const searchableSelect = read("../../ui/src/components/SearchableSelect.tsx");

    expect(css).toContain("--form-control-bg:");
    expect(css).toContain("--form-control-popover:");
    expect(css).toMatch(/select option,[\s\S]*background-color:\s*var\(--form-control-popover\)/);
    expect(css).toMatch(/\.themed-form-control\s*\{[\s\S]*background:\s*var\(--form-control-bg\)/);
    expect(css).toMatch(
      /\.themed-select-popover\s*\{[\s\S]*background:\s*var\(--form-control-popover\)/
    );
    expect(input).toContain("themed-form-control");
    expect(select).toContain("themed-form-control");
    expect(select).not.toContain("bg-[#0f0f16]");
    expect(searchableSelect).toContain("themed-select-popover");
    expect(searchableSelect).not.toContain("bg-[#13141c]");
  });
});

describe("Sidebar keyboard focus is not suppressed", () => {
  const src = read("../../ui/src/components/layout/Sidebar.tsx");

  test("nav items no longer stack !outline-none / focus-visible:!outline-none", () => {
    expect(src).not.toContain("!outline-none");
    expect(src).not.toContain("focus-visible:!outline-none");
  });

  test("sidebar navigation uses compact text and icon sizing", () => {
    expect(src).toContain("text-[13px]");
    expect(src).toContain("gap-2.5");
    expect(src).toContain("w-4 h-4 flex-shrink-0");
    expect(src).not.toContain("gap-3 rounded-xl text-sm font-medium");
    expect(src).not.toContain("w-5 h-5 flex-shrink-0");
  });
});

describe("modal action buttons keep shared padding and radius", () => {
  const glassButton = read("../../ui/src/components/ui/GlassButton.tsx");
  const chatSidebar = read("../../ui/src/pages/chat/SessionSidebar.tsx");
  const chatPage = read("../../ui/src/pages/Chat.tsx");
  const subagentPanel = read("../../ui/src/pages/chat/SubagentPanel.tsx");

  test("GlassButton applies sizing, radius, and focus treatment to every variant", () => {
    expect(glassButton).toContain("sizes[size]");
    expect(glassButton).not.toContain('variant !== "primary"');
    expect(glassButton).toContain("rounded-xl");
    expect(glassButton).toContain("font-medium");
    expect(glassButton).toContain("focus:ring-2");
  });

  test("confirmation and form modals use the shared Button primitive for footer actions", () => {
    expect(chatSidebar).not.toContain("<GlassButton");
    expect(chatSidebar).toMatch(/<Button\s+variant="danger"/);
    expect(chatPage).not.toContain("<GlassButton");
    expect(subagentPanel).not.toContain("<GlassButton");
    expect(subagentPanel).toMatch(/<Button\s+variant="primary"/);
    expect(subagentPanel).toMatch(/<Button\s+variant="danger"/);
  });
});
