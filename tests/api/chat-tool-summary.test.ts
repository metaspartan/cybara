import { describe, expect, test } from "bun:test";
import {
  buildNoUsableAssistantResponseMessage,
  buildUnsupportedAssistantClaimMessage,
  classifyToolCallResult,
  extractVisibleClarification,
  findAssistantEvidenceIssue,
  isNonSubstantiveAssistantCompletion,
  requiresToolEvidenceForMessage,
  requiredDirectToolForMessage,
  shouldPreferArtifactsForMessage,
  shouldRecoverNonSubstantiveAssistantCompletion,
  suppressRecoveredWebFailureActivities,
} from "../../src/api/chat-tool-summary";

describe("chat tool summary utilities", () => {
  test("classifies recoverable tool errors as failed calls", () => {
    expect(classifyToolCallResult({ output: "ok" })).toEqual({
      status: "completed",
    });
    expect(classifyToolCallResult({ error: "Text not found in file" })).toEqual({
      status: "failed",
      error: "Text not found in file",
    });
    expect(classifyToolCallResult({ output: "2 failures", exitCode: 1 })).toEqual({
      status: "failed",
      error: "2 failures",
    });
    expect(classifyToolCallResult({ success: false, message: "write rejected" })).toEqual({
      status: "failed",
      error: "write rejected",
    });
    expect(classifyToolCallResult({ status: "blocked" })).toEqual({
      status: "failed",
      error: "Tool finished with status blocked",
    });
  });

  test("recovers empty and bare success claims without overriding literal response requests", () => {
    expect(isNonSubstantiveAssistantCompletion("")).toBe(true);
    expect(isNonSubstantiveAssistantCompletion("Completed.")).toBe(true);
    expect(isNonSubstantiveAssistantCompletion("Task done!")).toBe(true);
    expect(isNonSubstantiveAssistantCompletion("Completed the import and verified 4 rows.")).toBe(
      false
    );
    expect(shouldRecoverNonSubstantiveAssistantCompletion("fix the import", "Completed", 0)).toBe(
      true
    );
    expect(
      shouldRecoverNonSubstantiveAssistantCompletion(
        "Respond with exactly Completed.",
        "Completed.",
        0
      )
    ).toBe(false);
    expect(shouldRecoverNonSubstantiveAssistantCompletion("fix the import", "Completed", 1)).toBe(
      false
    );
    expect(buildNoUsableAssistantResponseMessage()).toContain("couldn't produce a usable response");
    expect(buildNoUsableAssistantResponseMessage()).not.toContain("The model returned");
  });

  test("detects unsupported work and verification claims from actual tool outcomes", () => {
    expect(findAssistantEvidenceIssue("Done. I implemented the importer.", [])).toBe(
      "unsupported_completion"
    );
    expect(
      findAssistantEvidenceIssue("I have fixed the importer.", [
        { name: "read", result: { path: "/tmp/import.ts", content: "source" } },
      ])
    ).toBe("unsupported_completion");
    expect(
      findAssistantEvidenceIssue("I have fixed the importer.", [
        { name: "edit", status: "failed", result: { filePath: "/tmp/import.ts" } },
      ])
    ).toBe("unsupported_completion");
    expect(
      findAssistantEvidenceIssue("I have fixed the importer.", [
        { name: "edit", result: { filePath: "/tmp/import.ts" } },
      ])
    ).toBeUndefined();
    expect(
      findAssistantEvidenceIssue("I have created a task plan.", [
        { name: "todo", result: { items: [{ step: "Inspect", status: "in_progress" }] } },
      ])
    ).toBeUndefined();
    expect(
      findAssistantEvidenceIssue("All tests passed and the build is green.", [
        { name: "exec", result: { output: "3 failed", exitCode: 1 } },
      ])
    ).toBe("unsupported_verification");
    expect(
      findAssistantEvidenceIssue("All tests passed and the build is green.", [
        { name: "read", result: { path: "/tmp/test.log", content: "18 pass" } },
      ])
    ).toBe("unsupported_verification");
    expect(
      findAssistantEvidenceIssue("All tests passed and the build is green.", [
        { name: "exec", result: { output: "18 pass", exitCode: 0 } },
      ])
    ).toBeUndefined();
    expect(findAssistantEvidenceIssue("I asked. Waiting for your answer.", [])).toBe(
      "missing_clarification"
    );
    expect(buildUnsupportedAssistantClaimMessage("unsupported_completion")).toContain(
      "couldn't complete and verify"
    );
    expect(buildUnsupportedAssistantClaimMessage("missing_action_evidence")).not.toContain(
      "Cybara did not record"
    );
  });

  test("rejects whole-task completion claims while the latest plan is unfinished", () => {
    const unfinishedPlan = {
      name: "todo",
      result: {
        items: [
          { content: "Implement importer", status: "completed" },
          { content: "Verify imported rows", status: "in_progress" },
        ],
      },
    };
    expect(
      findAssistantEvidenceIssue("Done. Task complete and all plan items are satisfied.", [
        { name: "edit", result: { filePath: "/tmp/import.ts" } },
        unfinishedPlan,
      ])
    ).toBe("incomplete_plan");
    expect(
      findAssistantEvidenceIssue("Implementation is complete.", [
        unfinishedPlan,
        {
          name: "todo",
          result: {
            items: [
              { content: "Implement importer", status: "completed" },
              { content: "Verify imported rows", status: "completed" },
            ],
          },
        },
        { name: "edit", result: { filePath: "/tmp/import.ts" } },
      ])
    ).toBeUndefined();
  });

  test("distinguishes plan-only implementation replies from requested planning", () => {
    const plan = [
      "VibeMail - Next Phase Plan",
      "1. Backend: Add billing routes and subscription storage.",
      "2. Frontend: Build the pricing and account management screens.",
      "3. Deployment: Configure the production service.",
    ].join("\n");

    expect(
      findAssistantEvidenceIssue(plan, [], {
        userMessage: "Continue improving the email platform and add paid plans.",
      })
    ).toBe("plan_only");
    expect(
      findAssistantEvidenceIssue(plan, [], {
        userMessage: "Create an implementation plan for paid subscriptions.",
      })
    ).toBeUndefined();
    expect(
      findAssistantEvidenceIssue(plan, [], {
        allowPlanOnly: true,
        userMessage: "Continue improving the email platform and add paid plans.",
      })
    ).toBeUndefined();
    expect(
      findAssistantEvidenceIssue(
        plan,
        [{ name: "edit", result: { filePath: "/tmp/billing.ts" } }],
        { userMessage: "Continue improving the email platform and add paid plans." }
      )
    ).toBeUndefined();
    expect(
      findAssistantEvidenceIssue(
        plan,
        [{ name: "todo", result: { items: [{ step: "Add billing", status: "pending" }] } }],
        { userMessage: "Continue improving the email platform and add paid plans." }
      )
    ).toBe("plan_only");
  });

  test("detects explicit unfinished deliverables and permission deferrals", () => {
    const unfinished = [
      "I have not yet designed or written the required output file.",
      "Remaining steps: generate the final artifact and verify it.",
      "Want me to proceed with writing it?",
    ].join("\n\n");

    expect(
      findAssistantEvidenceIssue(unfinished, [], {
        userMessage: "Build the required artifact and verify it.",
      })
    ).toBe("unfinished_execution");
    expect(
      findAssistantEvidenceIssue("I stopped here because I was asked to stop.", [], {
        userMessage: "Continue and finish the implementation.",
      })
    ).toBe("unfinished_execution");
  });

  test("allows requested planning and explicit approval boundaries", () => {
    const deferral =
      "I mapped the remaining work. Would you like me to proceed with implementing it?";

    expect(
      findAssistantEvidenceIssue(deferral, [], {
        userMessage: "Create an implementation plan for the importer.",
      })
    ).toBeUndefined();
    expect(
      findAssistantEvidenceIssue(deferral, [], {
        userMessage: "Review the importer and wait for my approval before making changes.",
      })
    ).toBeUndefined();
  });

  test("requires provider-neutral evidence for actionable work but not ordinary answers", () => {
    expect(requiresToolEvidenceForMessage("Fix the importer and test it.")).toBe(true);
    expect(requiresToolEvidenceForMessage("Could you please fix the importer?")).toBe(true);
    expect(requiresToolEvidenceForMessage("The importer is broken, please fix it.")).toBe(true);
    expect(requiresToolEvidenceForMessage("The build failed; investigate this project.")).toBe(
      true
    );
    expect(requiresToolEvidenceForMessage("Here is the context.\nPlease continue the work.")).toBe(
      true
    );
    expect(requiresToolEvidenceForMessage("Continue")).toBe(true);
    expect(requiresToolEvidenceForMessage("Review and audit this codebase.")).toBe(true);
    expect(requiresToolEvidenceForMessage("Look into the gateway crash.")).toBe(true);
    expect(requiresToolEvidenceForMessage("Create an implementation plan for the importer.")).toBe(
      false
    );
    expect(requiresToolEvidenceForMessage("What is dependency injection?")).toBe(false);
    expect(requiresToolEvidenceForMessage("Respond with exactly Completed.")).toBe(false);
  });

  test("detects actionable answers backed only by non-evidence tools", () => {
    expect(
      findAssistantEvidenceIssue(
        "The codebase is production ready and the architecture is sound.",
        [{ name: "todo", result: { items: [{ step: "Review", status: "completed" }] } }],
        {
          requireActionEvidence: true,
          userMessage: "Review and audit this codebase.",
        }
      )
    ).toBe("missing_action_evidence");
    expect(
      findAssistantEvidenceIssue(
        "The codebase uses a modular API boundary.",
        [{ name: "read", result: { path: "/tmp/api.ts", content: "export {}" } }],
        {
          requireActionEvidence: true,
          userMessage: "Review and audit this codebase.",
        }
      )
    ).toBeUndefined();
  });

  test("turns a structured clarification result into a visible question", () => {
    expect(
      extractVisibleClarification([
        {
          name: "clarify",
          result: {
            awaiting: "user",
            header: "Data source",
            question: "Which source should be authoritative?",
            options: [
              { label: "API", description: "Use the official endpoint" },
              { label: "Files", description: "Use the checked-in data" },
            ],
          },
        },
      ])
    ).toBe(
      "**Data source**\n\nWhich source should be authoritative?\n\n1. **API** — Use the official endpoint\n2. **Files** — Use the checked-in data"
    );
  });

  test("binds explicit desktop actions to computer use without forcing capability questions", () => {
    expect(
      requiredDirectToolForMessage(
        "Move the computer-use cursor, capture the desktop, and report the frontmost app"
      )
    ).toBe("computer_use");
    expect(requiredDirectToolForMessage("Take a screenshot of my screen")).toBe("computer_use");
    expect(requiredDirectToolForMessage("What is computer use?")).toBeUndefined();
    expect(requiredDirectToolForMessage("Explain desktop automation security")).toBeUndefined();
  });

  test("binds explicit command execution to exec without forcing explanations", () => {
    expect(
      requiredDirectToolForMessage(
        "Run exec exactly once with command sleep 30; printf CROSS_SESSION_TOOL_DONE"
      )
    ).toBe("exec");
    expect(requiredDirectToolForMessage("Execute the terminal command bun test")).toBe("exec");
    expect(
      requiredDirectToolForMessage(
        "Use the command tool to run exactly: sleep 30; printf STEER_BASE_UNEXPECTED"
      )
    ).toBe("exec");
    expect(requiredDirectToolForMessage("What is the exec tool?")).toBeUndefined();
    expect(requiredDirectToolForMessage("Explain how a shell command works")).toBeUndefined();
  });

  test("binds explicit outbound channel messages without forcing channel explanations", () => {
    expect(requiredDirectToolForMessage("Send a message to Carsen in Discord and say hello")).toBe(
      "message"
    );
    expect(requiredDirectToolForMessage("Post in #cybara and say hi to everyone")).toBe("message");
    expect(requiredDirectToolForMessage("Send this to @cybara_updates on Telegram")).toBe(
      "message"
    );
    expect(requiredDirectToolForMessage("Publish this in the Slack channel")).toBe("message");
    expect(requiredDirectToolForMessage("How does a Discord channel work?")).toBeUndefined();
  });

  test("does not flag substantive answers as missing action evidence", () => {
    const substantive =
      "Here is where things stand. The training run reached step 2300 with the planner fix " +
      "applied, and the binder suite is green again. I also re-ran the live evals and the " +
      "regression set; both are back to baseline with zero paired regressions, so the " +
      "change is safe to keep. The remaining work is tracked on the todo list for the next pass.";
    expect(
      findAssistantEvidenceIssue(substantive, [], { requireActionEvidence: true })
    ).toBeUndefined();
    expect(findAssistantEvidenceIssue("Done.", [], { requireActionEvidence: true })).toBe(
      "missing_action_evidence"
    );
  });

  test("detects artifact-focused prompts for artifact-preferred tool execution", () => {
    expect(
      shouldPreferArtifactsForMessage("audit this codebase and create an artifact report when done")
    ).toBe(true);
    expect(
      shouldPreferArtifactsForMessage(
        "make an implementation.md.resolved and walkthrough.md.resolved"
      )
    ).toBe(true);
    expect(shouldPreferArtifactsForMessage("hello what can you do")).toBe(false);
  });

  test("hides recovered web failures from the main timeline", () => {
    const activities = [
      { phase: "error", toolName: "web_fetch", text: "Fetch failed" },
      { phase: "result", toolName: "web_fetch", text: "Fetched source" },
      { phase: "error", toolName: "exec", text: "Command failed" },
    ];
    const filtered = suppressRecoveredWebFailureActivities(activities, [
      { name: "web_fetch", result: { error: "HTTP 404" } },
      { name: "web_fetch", result: { content: "Primary source text" } },
    ]);

    expect(filtered).toEqual([
      { phase: "result", toolName: "web_fetch", text: "Fetched source" },
      { phase: "error", toolName: "exec", text: "Command failed" },
    ]);
  });

  test("keeps web failures visible when no source succeeded", () => {
    const activities = [{ phase: "error", toolName: "web_search", text: "Search failed" }];
    expect(
      suppressRecoveredWebFailureActivities(activities, [
        { name: "web_search", result: { count: 0, results: [] } },
        { name: "web_fetch", result: { error: "HTTP 404" } },
      ])
    ).toEqual(activities);
  });
});
