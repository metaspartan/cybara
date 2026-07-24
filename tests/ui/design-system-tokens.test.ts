import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readUiStylesSource } from "../shared/source-bundles";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("index.css design-system utilities", () => {
  const css = readUiStylesSource();
  const sessionSidebar = read("../../ui/src/pages/chat/SessionSidebar.tsx");

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
    expect(css).toMatch(
      /textarea\[data-chat-composer-input="true"\]::placeholder\s*\{[\s\S]*?color:\s*var\(--form-control-placeholder\)/
    );
  });

  test("chat code and composer surfaces follow semantic theme tokens", () => {
    const composer = read("../../ui/src/pages/chat/ChatComposer.tsx");
    const messageContent = read("../../ui/src/pages/chat/MessageContent.tsx");
    const branchSelector = read("../../ui/src/pages/chat/GitBranchSelector.tsx");

    expect(css).toContain("--chat-inline-code-bg:");
    expect(css).toContain("--chat-code-bg:");
    expect(css).toContain(".chat-inline-code");
    expect(css).toContain(".chat-code-surface");
    expect(css).toContain(".new-chat-workspace-bar");
    expect(composer).not.toContain("placeholder-gray-500");
    expect(messageContent).not.toContain("text-indigo-100");
    expect(branchSelector).not.toContain("border-[#2b303b]");
    expect(branchSelector).toContain("theme-tooltip-panel");
  });

  test("chat context ring and tooltip have light and dark theme tokens", () => {
    expect(css).toContain("--context-ring-ok");
    expect(css).toContain("--context-ring-warn");
    expect(css).toContain("--context-ring-danger");
    expect(css).toContain("--context-ring-track");
    expect(css).toContain("--context-ring-inner");
    expect(css).toContain("--context-tooltip-bg");
    expect(css).toContain("--context-tooltip-title: var(--text-muted)");
    expect(css).toContain("--context-tooltip-body: var(--text-secondary)");
    expect(css).toContain("--context-tooltip-detail: var(--text-primary)");
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

  test("chat sidebar neutral colors follow semantic theme tokens", () => {
    expect(css).toContain("--text-primary: var(--icon-hover)");
    expect(css).toMatch(/html\[data-theme-mode="sand-dune"\][\s\S]*--text-muted:\s*#a39785/);
    expect(css).toMatch(/html\[data-theme-mode="sand-dune"\][\s\S]*--text-subtle:\s*#7d7467/);
    expect(css).toContain(".theme-tooltip-panel");
    expect(sessionSidebar).toContain("theme-tooltip-panel");
    expect(sessionSidebar).toContain("themed-form-control");
    expect(sessionSidebar).not.toContain("placeholder:text-gray-600");
    expect(sessionSidebar).not.toContain("bg-[#181820]/95");
  });

  test("honors prefers-reduced-motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  test("ships semantic Catppuccin, Matrix, and custom theme surfaces", () => {
    const sidebar = read("../../ui/src/components/layout/Sidebar.tsx");
    expect(css).toMatch(/html\[data-theme-mode="catppuccin"\][\s\S]*--surface-panel:\s*#1e1e2e/);
    expect(css).toMatch(/html\[data-theme-mode="matrix"\][\s\S]*--surface-panel:\s*#06120a/);
    expect(css).toContain('html[data-theme-mode="custom"][data-translucent-sidebar="false"]');
    expect(sidebar).toContain("cybara-main-sidebar");
  });

  test("ships distinct dark preset surfaces", () => {
    const store = read("../../ui/src/stores/uiStore.ts");
    const previews = read("../../ui/src/pages/settings/theme/ThemePresetGrid.tsx");
    const terminal = read("../../ui/src/pages/ide/xtermTheme.ts");

    expect(store).toContain('{ value: "graphite", label: "Graphite"');
    expect(store).toContain('{ value: "oled", label: "OLED Black"');
    expect(store).toContain('{ value: "deep-ocean", label: "Deep Ocean"');
    expect(store).toContain('{ value: "burgundy", label: "Burgundy"');
    expect(css).toMatch(/html\[data-theme-mode="graphite"\][\s\S]*--surface-backdrop:\s*#171717/);
    expect(css).toMatch(/html\[data-theme-mode="graphite"\][\s\S]*--surface-raised:\s*#2b2b2b/);
    expect(css).toMatch(/html\[data-theme-mode="oled"\][\s\S]*--surface-backdrop:\s*#000000/);
    expect(css).toMatch(/html\[data-theme-mode="deep-ocean"\][\s\S]*--surface-panel:\s*#0b1a1d/);
    expect(css).toMatch(/html\[data-theme-mode="burgundy"\][\s\S]*--surface-panel:\s*#211116/);
    expect(previews).toMatch(/graphite:\s*\{[\s\S]*?background:\s*"#171717"/);
    expect(previews).toMatch(/oled:\s*\{[\s\S]*?background:\s*"#000000"/);
    expect(previews).toContain('"deep-ocean": {');
    expect(previews).toMatch(/burgundy:\s*\{[\s\S]*?background:\s*"#160b0e"/);
    expect(terminal).toContain('graphite: "#171717"');
    expect(terminal).toContain('oled: "#000000"');
    expect(terminal).toContain('"deep-ocean": "#061012"');
    expect(terminal).toContain('burgundy: "#160b0e"');
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

  test("keeps assistant responses clear of the chat viewport edges", () => {
    const chat = read("../../ui/src/pages/Chat.tsx");
    const layout = read("../../ui/src/pages/chat/chatAppearanceLayout.ts");
    expect(chat).toContain("chatHorizontalPaddingClassName(chatAppearance.horizontalPadding)");
    expect(layout).toContain('default: "px-5 sm:px-8"');
    expect(chat).not.toContain("flex-1 overflow-y-auto px-3 py-4 sm:px-4");
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
    expect(searchableSelect).toContain("selectedOption?.badge");
    expect(searchableSelect).toContain("option.badge");
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
