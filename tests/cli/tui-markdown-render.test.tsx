import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToString } from "ink";
import { TerminalMessageBody } from "../../src/cli-tui-markdown-render";

describe("CLI TUI markdown rendering", () => {
  test("keeps adjacent table and list rows on separate wrapped lines", () => {
    const output = renderToString(
      <TerminalMessageBody
        content={[
          "| File | Lines | Size |",
          "| --- | ---: | ---: |",
          "| `index.html` | 246 | 9 KB |",
          "- **Device toggle** updates power draw and activity",
          "Verified working",
        ].join("\n")}
      />,
      { columns: 46 },
    );

    expect(output).toContain("| File | Lines | Size |");
    expect(output).toContain("• Device toggle updates power draw and");
    expect(output.split("\n")).toContain("activity");
    expect(output).toContain("Verified working");
    expect(output).not.toContain("Size |Verified");
    expect(output).not.toContain("activityVerified");
  });

  test("preserves inline emphasis without truncating narrow output", () => {
    const output = renderToString(
      <TerminalMessageBody
        content="- **SolarFlow** remains complete in a narrow terminal viewport"
      />,
      { columns: 28 },
    );

    expect(output).toContain("• SolarFlow remains complete");
    expect(output.split("\n")).toContain(" in a narrow terminal");
    expect(output.split("\n")).toContain("viewport");
    expect(output).not.toContain("...");
  });
});
