---
name: adversarial-ux-test
description: Test an app as a difficult, low-patience persona, then filter complaints into actionable UX issues.
metadata: {"cybara":{"requires":{"anyBins":["chromium","google-chrome","msedge"]}}}
---

# Adversarial UX Test

Use this before demos, launches, onboarding changes, or major UI releases when the user wants friction found by a realistic hard-to-please persona.

## Workflow

1. Define one persona:
   - Role, age range, technical comfort, core task, frustration triggers, and voice.
2. Browse the app as that persona:
   - First impression.
   - Core workflow.
   - Error recovery.
   - Readability and accessibility.
   - Speed and perceived effort.
   - Terminology.
   - Navigation and return paths.
3. Record evidence:
   - Screenshots for each major issue.
   - Console errors.
   - Network failures.
   - Click count for the core task.
4. Write the persona rant:
   - In character, with concrete quotes and page references.
5. Apply the pragmatism filter:
   - Red: real UX bug.
   - Yellow: valid but lower priority.
   - Green: feature request with strong value.
   - White: persona noise.
6. Produce tickets only for Red and Green items.

## Rules

- One persona per session.
- Test the core workflow before touring settings.
- Do not create more than 10 tickets.
- Separate entertaining persona feedback from objective product findings.
- Do not turn "I hate computers" into product work unless it exposes a real accessibility or workflow issue.

## Report Shape

```text
Persona: <name and constraints>
Task: <core task>
Verdict: <would they keep using it?>

Persona feedback:
- "<quote>" - <what happened>

Filtered findings:
- RED: <issue, evidence, suggested fix>
- YELLOW: <issue>
- GREEN: <request>
- WHITE: <noise>

Tickets:
- <title> - <evidence> - <fix>
```
