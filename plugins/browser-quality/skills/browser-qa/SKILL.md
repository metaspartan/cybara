---
name: browser-qa
description: Validate web applications through the embedded browser with responsive, interaction, console, and screenshot checks.
---

# Browser quality

Use the embedded browser for interactive validation when a task changes or audits a web interface.

## Workflow

1. Start the application with the repository's existing Bun script and wait for its health endpoint or listening address.
2. Open the application in the embedded browser and confirm the initial page renders without console errors.
3. Exercise the primary workflow with real clicks, typing, navigation, and state changes.
4. Repeat the workflow at representative desktop and narrow viewport sizes.
5. Capture screenshots of the meaningful finished states and inspect them for clipping, overlap, empty regions, and broken assets.
6. Verify keyboard focus order, accessible labels, reduced motion, and light and dark theme behavior when supported.
7. Report the tested URL, viewport sizes, interactions, console failures, and screenshot paths.

## Reliability

- Wait on observable UI state instead of fixed sleeps.
- Reuse the current embedded browser session so the user can follow the run.
- Do not claim visual correctness from source inspection alone.
- Keep authentication and destructive actions within the user's stated scope.
