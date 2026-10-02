# Live chat plans and latest-plan updates

Plans now have an authoritative session snapshot independent of transcript ordering. Successful `todo` updates persist a monotonic revision, update time and run identity, and publish a `session_plan` event immediately. The UI refreshes the snapshot when selecting a session, reconnecting, or observing the end of a turn. Old events and delayed requests cannot replace newer revisions; requests are cancelled when switching sessions.

## Visible outcomes

| State | Meaning |
| --- | --- |
| Active | The turn is running and the plan has unfinished items. |
| Completed | Every retained item is completed or cancelled. Cancelled items are excluded from the completion denominator. |
| Paused | The turn was stopped, failed unexpectedly, or recovered after a gateway interruption. Unfinished tasks stay visible. |
| Turn ended / needs update | The assistant returned without reconciling unfinished plan items. The card says how many need an update instead of looking continuously active. |
| Cleared | An explicit empty plan cleared the current snapshot. Older transcript plans do not return. |

A lifecycle label does **not** change individual item statuses or claim unverified work is finished. Malformed, failed, executing, or cancelled tool updates do not become successful plans. Rewinding a chat reconstructs only the retained plan and publishes a newer revision, including an explicit clear when no retained plan remains. Deleting a session removes its stored plan.

Recovered active plans get a new paused revision. This matters when the UI stays mounted through a gateway restart: the recovered snapshot must supersede the old active event even if its envelope timestamp differs.

## Presentation

The latest-plan card shows the actual update time and explicit item statuses. Paused and needs-update labels have their own line so they do not truncate “Latest plan update.” Verified desktop and narrow-width rendering has no card overflow. Completed plans show “No active task”; paused work remains actionable rather than being silently completed.

## Verification — October 1, 2026

- 44 focused backend/API/UI tests passed, including ordering, failed-call filtering, writer handoff, cancellation, invalid arguments, revision-safe rewind and restart recovery.
- Five rendered end-to-end tests passed: live completion with cancellation, unfinished final response plus reload/restart, provider-error pause, reconnect without reloading the mounted page, and stop/clear plus 1280px/390px layout checks.
- A real locally authorized `space-bunny-free` agent created a three-item plan, read the fixture and correctly computed `12 / ORCHID-942`, reconciled all three items, and displayed `3/3 complete` after reload. A second real turn was stopped and displayed `Paused · 2 tasks remain` after reload. No UI page errors were observed. Requested reasoning effort for the successful live run was low.
- Earlier broader live-model attempts timed out or were stopped during repeated provider/tool rounds; those attempts were not counted as successful completions. Deterministic UI tests cover lifecycle recovery independently of hosted-provider responsiveness.
- Full local `bun run check:ci` passed after the final source changes: all eight smoke groups green; existing platform-specific skips remained unchanged. An earlier run had an intermittent unrelated terminal smoke failure; its isolated rerun and the final full gate passed.

The live gateway on port 4269 and installed desktop were not restarted or replaced. These source changes require a gateway/UI update to reach that installation; the isolated verification preview runs on port 4475. No guarantee is made that a hosted provider or arbitrary future task can never stall—this change keeps the plan’s observed state current and truthful.
