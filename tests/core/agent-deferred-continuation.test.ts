import { describe, expect, test } from "bun:test";
import {
  DEFERRED_EXECUTION_CONTINUATION_PROMPT,
  redactExposedCredentials,
  requestedDeliverableNeedsInspection,
  requestedDeliverableNeedsExtendedEvidence,
  requestedDeliverablePathsFromMessages,
  shouldContinueDeferredExecution,
  toolCallContainsExposedCredential,
  toolCallContainsPlaceholder,
  toolsForInitialDeliverableInspection,
  toolsForDeferredDeliverable,
} from "../../src/core/agent-deferred-continuation";

const inspectionCall = [
  {
    id: "inspect",
    name: "read",
    args: { path: "schema.sql" },
    result: { content: "schema" },
  },
];

describe("deferred agent execution", () => {
  test("nudges deferred work toward direct concise execution", () => {
    expect(DEFERRED_EXECUTION_CONTINUATION_PROMPT).toContain("Do not repeat completed inspection");
    expect(DEFERRED_EXECUTION_CONTINUATION_PROMPT).toContain(
      "keep reasoning and tool calls focused"
    );
  });

  test("preserves original deliverable targets across continuation turns", () => {
    const messages = [
      { role: "user", content: "Generate `output/output.html` from the supplied specification." },
      { role: "assistant", content: "The preview failed. Shall I proceed from the specification?" },
      { role: "user", content: DEFERRED_EXECUTION_CONTINUATION_PROMPT },
    ];
    expect(requestedDeliverablePathsFromMessages(messages)).toEqual(["output/output.html"]);
    expect(
      shouldContinueDeferredExecution(
        messages,
        "The deliverable has not been produced yet. I can create it now.",
        inspectionCall
      )
    ).toBe(true);
  });

  test("resolves workspace-prefixed targets from the active workspace root", () => {
    expect(
      requestedDeliverablePathsFromMessages([
        {
          role: "user",
          content:
            "Create `workspace/skills/file-index-monitor/SKILL.md` and write `reports/audit.json`.",
        },
      ])
    ).toEqual(["skills/file-index-monitor/SKILL.md", "reports/audit.json"]);
  });

  test("distinguishes evidence-heavy deliverables from ordinary artifact tasks", () => {
    expect(
      requestedDeliverableNeedsExtendedEvidence([
        {
          role: "user",
          content: "Extract all decisions from the meeting transcript into `output/report.md`.",
        },
      ])
    ).toBe(true);
    expect(
      requestedDeliverableNeedsExtendedEvidence([
        { role: "user", content: "逐项分析会议记录并写入 `output/report.md`。" },
      ])
    ).toBe(true);
    expect(
      requestedDeliverableNeedsExtendedEvidence([
        { role: "user", content: "Audit this API configuration and write `output/report.md`." },
      ])
    ).toBe(false);
    expect(
      requestedDeliverableNeedsExtendedEvidence([
        {
          role: "user",
          content: "Inspect the index and determine the root cause, then write `output/report.md`.",
        },
      ])
    ).toBe(true);
  });

  test("starts inspection tasks without exposing premature mutation tools", () => {
    const tools = [
      { name: "todo" },
      { name: "read" },
      { name: "exec" },
      { name: "image" },
      { name: "write" },
    ];
    const messages = [
      { role: "user", content: "Inspect the current index and write `output/report.md`." },
    ];
    expect(requestedDeliverableNeedsInspection(messages)).toBe(true);
    expect(toolsForInitialDeliverableInspection(tools, true)).toEqual([
      { name: "read" },
      { name: "exec" },
      { name: "image" },
    ]);
    expect(toolsForInitialDeliverableInspection(tools, false)).toEqual(tools);
  });

  test("limits missing-file continuation turns to mutation tools", () => {
    const tools = [{ name: "read" }, { name: "write" }, { name: "edit" }, { name: "exec" }];
    expect(toolsForDeferredDeliverable(tools, 0, ["output/output.html"])).toEqual(tools);
    expect(toolsForDeferredDeliverable(tools, 1, ["output/output.html"])).toEqual([
      { name: "write" },
      { name: "edit" },
    ]);
    expect(toolsForDeferredDeliverable(tools, 1, [])).toEqual(tools);
  });

  test("continues explicit promises to execute in a later turn", () => {
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Implement the migration and verify the database." }],
        "Ready to proceed — executing the migration next.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Decode the file and save the output." }],
        "I'll proceed with implementation on the next turn.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Write and execute the database migration." }],
        "Proceeding with the implementation now.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Write and execute the database migration." }],
        "I've completed the inspection. I'll proceed to write the migration, execute it, and produce the write-up.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [
          {
            role: "user",
            content: "Your goal is to produce output/encoded.dat and save a write-up.",
          },
        ],
        "## Plan\n1. Build the encoder.\n2. Verify the round trip.\n3. Write the output file.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Produce the encoded file and verify it." }],
        "I need to continue the task because the target has not been read yet. Let me proceed.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Produce the encoded file and verify it." }],
        "The partial encoder is incorrect. Next steps, had I been permitted to continue, would isolate the bug.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Produce output/encoded.dat and save a write-up." }],
        "I'm ready to write the encoder when you give the go-ahead.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Produce output/encoded.dat and save a write-up." }],
        "I haven't written the encoder yet. Next step would be to create it and verify the round trip.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Generate output/output.html from the supplied specification." }],
        "The image preview failed. I'd like to confirm before proceeding: shall I generate the HTML from the complete written specification?",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Generate output/output.html from the supplied score." }],
        "I have the image. Let me plan the SVG reproduction. Now I'll generate the HTML file.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Generate output/output.html from the supplied score." }],
        "I've examined the image. Now let me build the SVG.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Generate output/output.html from the supplied score." }],
        "I can see the image clearly. Now I'll plan a todo list and build the SVG.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Generate output/output.html from the supplied score." }],
        "I haven't called any tools yet in this turn. Let me start the work: I'll inspect the image, then build the SVG via a Python generator.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Generate output/output.html from the supplied score." }],
        "The image confirms the requested structure. I have enough information to build the deliverable now.",
        inspectionCall
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Generate output/output.html from the supplied score." }],
        "The task is already complete. The musical title is displayed in the SVG. The task is finished.",
        [
          { name: "exec", args: { command: "ls -la /workspace/output" }, result: "" },
          { name: "image", args: { image: "/workspace/score.png" }, result: {} },
        ]
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Create a report file called `report.md`." }],
        "The report is complete.",
        [
          {
            name: "write",
            args: { path: "report.md", content: "import os\n\ndef build():\n    return {}\n" },
            result: { success: true },
          },
        ]
      )
    ).toBe(true);
  });

  test("does not continue requested planning or approval-gated work", () => {
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Create an implementation plan for the migration." }],
        "Ready to proceed — implementing the migration next.",
        inspectionCall
      )
    ).toBe(false);
    expect(
      shouldContinueDeferredExecution(
        [
          {
            role: "user",
            content: "Review the migration and wait for my approval before making changes.",
          },
        ],
        "Ready to proceed — implementing the migration next.",
        inspectionCall
      )
    ).toBe(false);
    expect(
      shouldContinueDeferredExecution(
        [
          {
            role: "user",
            content:
              "Instead of creating files directly, bootstrap a Python library project plan and save the task list as JSON.",
          },
        ],
        "## Plan\n1. Create the package.\n2. Write tests.\n3. Build the README.",
        inspectionCall
      )
    ).toBe(false);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Diagnose why the encoder fails." }],
        "The next step would be to write a replacement encoder.",
        inspectionCall
      )
    ).toBe(false);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Diagnose why the score renderer fails." }],
        "I have enough information to build a replacement now.",
        inspectionCall
      )
    ).toBe(false);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Generate output/output.html from the supplied score." }],
        "The task is complete.",
        [
          {
            name: "exec",
            args: { command: "python generate_score.py" },
            result: { exitCode: 0 },
          },
        ]
      )
    ).toBe(false);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Save the final answer to `output/answer.md`." }],
        "The answer file is ready.",
        [
          {
            name: "write",
            args: { path: "output/answer.md", content: "Placeholder: TODO after analysis" },
            result: { success: true },
          },
        ]
      )
    ).toBe(true);
  });

  test("continues when analysis never materializes the requested output path", () => {
    expect(
      shouldContinueDeferredExecution(
        [
          {
            role: "user",
            content:
              "Analyze the supplied map, then save the result to `output/output.html` as inline SVG.",
          },
        ],
        "I traced every route and established the complete color palette.",
        [
          { name: "image", args: { image: "fixtures/map.png" }, result: {} },
          {
            name: "exec",
            args: { command: "F=$(ls fixtures); python3 analyze.py" },
            result: { stdout: "analysis complete" },
          },
        ]
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [
          {
            role: "user",
            content:
              "Analyze the supplied map, then save the result to `output/output.html` as inline SVG.",
          },
        ],
        "The requested map is complete.",
        [
          {
            name: "write",
            args: { path: "output/output.html", content: "<svg></svg>" },
            result: { success: true },
          },
        ]
      )
    ).toBe(true);
    expect(
      shouldContinueDeferredExecution(
        [
          {
            role: "user",
            content:
              "Analyze the supplied map, then save the result to `output/output.html` as inline SVG.",
          },
        ],
        "The requested map is complete.",
        [
          {
            name: "write",
            args: {
              path: "output/output.html",
              content: '<svg><path d="M0 0 L10 10" stroke="red"/></svg>',
            },
            result: { success: true },
          },
        ]
      )
    ).toBe(false);
  });

  test("continues after a requested-file mutation fails", () => {
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Generate `output/output.html` from the supplied score." }],
        "The requested map is complete.",
        [
          {
            name: "write",
            args: {
              path: "output/output.html",
              content: '<svg><path d="M0 0 L10 10" stroke="red"/></svg>',
            },
            result: { error: "disk full" },
          },
        ]
      )
    ).toBe(true);
  });

  test("recognizes an output path in a non-English request", () => {
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "请将最终答案保存到 `output/answer.md`。" }],
        "分析完成。",
        [{ id: "read-1", name: "read", args: { path: "input.jpg" }, result: "ok" }]
      )
    ).toBe(true);
  });

  test("recognizes a deliverable described as a named file", () => {
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Extract the decisions into a file called `decisions.md`." }],
        "I finished the analysis.",
        [{ id: "read-1", name: "read", args: { path: "transcript.md" }, result: "ok" }]
      )
    ).toBe(true);
  });

  test("does not mistake an input fixture for a requested deliverable", () => {
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Create a concise report about `fixtures/input.csv`." }],
        "The report is complete and includes all requested findings.",
        inspectionCall
      )
    ).toBe(false);
  });

  test("requires real tool activity and a user request", () => {
    expect(
      shouldContinueDeferredExecution(
        [{ role: "user", content: "Implement the migration." }],
        "Ready to proceed — implementing the migration next.",
        []
      )
    ).toBe(false);
    expect(
      shouldContinueDeferredExecution(
        [{ role: "system", content: "Be helpful." }],
        "Ready to proceed — implementing the migration next.",
        inspectionCall
      )
    ).toBe(false);
  });

  test("detects exposed credentials in deliverable content", () => {
    expect(
      toolCallContainsExposedCredential({
        name: "write",
        args: {
          path: "audit.md",
          content: "AWS access key: AKIAIOSFODNN7EXAMPLE",
        },
      })
    ).toBe(true);
    expect(
      toolCallContainsExposedCredential({
        name: "write",
        args: {
          path: "audit.md",
          content: "AWS access key: `AKIA…MPLE` (redacted)",
        },
      })
    ).toBe(false);
    expect(redactExposedCredentials("Key: AKIAIOSFODNN7EXAMPLE")).toBe("Key: AKIA…MPLE");
  });

  test("detects placeholder deliverables before mutation", () => {
    expect(
      toolCallContainsPlaceholder({
        name: "write",
        args: { path: "output/output.html", content: "PLACEHOLDER — replaced later" },
      })
    ).toBe(true);
    expect(
      toolCallContainsPlaceholder({
        name: "write",
        args: {
          path: "qa_exchanges.md",
          content: "The sandbox refused access, so this reconstruction is without read access.",
        },
      })
    ).toBe(true);
    expect(
      toolCallContainsPlaceholder({
        name: "write",
        args: {
          path: "qa_exchanges.md",
          content: "The exchanges identified so far are below. Remaining entries continue below.",
        },
      })
    ).toBe(true);
    expect(
      toolCallContainsPlaceholder({
        name: "write",
        args: {
          path: "qa_exchanges.md",
          content:
            "The remaining transcript could not be extracted. This file should be regenerated.",
        },
      })
    ).toBe(true);
    expect(
      toolCallContainsPlaceholder({
        name: "write",
        args: {
          path: "output/audit_report.md",
          content:
            "Audit report content is complete and evidence-backed; see output/audit_report.md.",
        },
      })
    ).toBe(true);
    expect(
      toolCallContainsPlaceholder({
        name: "write",
        args: { path: "qa_exchanges.md", content: "This file is being populated from evidence." },
      })
    ).toBe(true);
    expect(
      toolCallContainsPlaceholder({
        name: "write",
        args: {
          path: "qa_exchanges.md",
          content: "Individual exchanges will be added in the next revision.",
        },
      })
    ).toBe(true);
    expect(
      toolCallContainsPlaceholder({
        name: "write",
        args: {
          path: "output/output.html",
          content: '<svg><path d="M0 0 L10 10" stroke="red"/></svg>',
        },
      })
    ).toBe(false);
  });
});
