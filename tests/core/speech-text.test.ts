import { describe, expect, test } from "bun:test";
import { speechTextFromMarkdown } from "../../src/core/speech-text";

describe("speech text preparation", () => {
  test("removes Markdown syntax while preserving readable content", () => {
    expect(
      speechTextFromMarkdown(`## Result

**Important:** use [Cybara](https://example.com) with \`bun run dev\`.

- First item
- Second *item*

> Ready &amp; tested.`)
    ).toBe(
      "Result\n\nImportant: use Cybara with bun run dev.\n\nFirst item\nSecond item\n\nReady & tested."
    );
  });

  test("removes fences, image targets, tables, and escaped formatting tokens", () => {
    expect(
      speechTextFromMarkdown(`![Chart](chart.png)

| Name | Value |
| --- | --- |
| Alpha | **42** |

\`\`\`ts
const answer = 42;
\`\`\`

Literal \\* star`)
    ).toBe("Chart\n\nName Value\nAlpha 42\n\nconst answer = 42;\n\nLiteral * star");
  });
});
