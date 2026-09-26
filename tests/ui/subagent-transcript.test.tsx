import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "../../ui/node_modules/react-dom/server";
import type { ChatMessage } from "../../ui/src/types";
import { SubagentTranscript } from "../../ui/src/pages/chat/SubagentTranscript";

test("renders full API transcript messages without requiring an id field", () => {
  const messages: ChatMessage[] = [{
    role: "assistant", content: "Visible answer", thinking: "Reasoning preserved",
    tool_calls: [{name: "read", arguments: {path: "fixture.txt"}, result: "Tool output", error: "Tool failure", status: "error"}],
    images: [{data: "aGVsbG8=", mimeType: "image/png", name: "Diagram"}],
  }, {role: "user", content: "Plain question"}];
  const html = renderToStaticMarkup(<SubagentTranscript messages={messages} onOpenLink={() => false} />);
  for (const text of ["Visible answer", "Reasoning preserved", "Thinking", "read", "fixture.txt", "Tool output", "Tool failure", "Diagram", "data:image/png;base64,aGVsbG8=", "Plain question"]) expect(html).toContain(text);
  expect((html.match(/<article/g) ?? []).length).toBe(2);
});

test("renders an empty transcript and metadata-only messages safely", () => {
  expect(renderToStaticMarkup(<SubagentTranscript messages={[]} onOpenLink={() => false} />)).toBe("");
  const html = renderToStaticMarkup(<SubagentTranscript messages={[{role: "assistant", content: "", thinking: "Only thinking", tool_calls: []}]} onOpenLink={() => false} />);
  expect(html).toContain("Only thinking");
});
