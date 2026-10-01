# Active context usage and compaction

The context ring reports the active model window, not the lifetime sum of every prompt or the full archived chat transcript.

## What changes after compaction

A successful provider request records its current input plus output token count in a small persisted active-context snapshot. OpenAI-compatible, Anthropic and Responses-style runtimes feed this measurement; when provider usage is unavailable, the request-visible estimate is used. Mid-loop tool compaction records its reduced request estimate immediately. Status events carry updated context usage to the visible chat, so it need not wait for a page reload or final answer.

At turn completion the snapshot is anchored to the active conversation's non-system-message boundary. Later turns add only newly appended messages until a new provider measurement arrives. System instruction-ledger restoration does not re-add archived messages to the gauge. Summary replacement, context reset and agent switching invalidate obsolete anchors. Lifetime billed usage remains separate and is not decremented by compaction.

`contextUsage.source` distinguishes `provider` from `estimated`. Full transcript history remains available independently; `metadataTokens` is reserved for non-replayed transcript metadata, not a misleading name for all content removed by compaction.

Nested tool argument and result mutations invalidate token estimates and replay preview caches. Changing an existing tool result therefore cannot keep an old high estimate or resend a stale preview merely because the containing array/object has the same identity.

## Verification

- Regression fixture: more than one million archived input tokens → 32,000 active tokens / 1,000,000 limit; history retained.
- Rendered app integration test: same reduction via gateway, live status websocket and context ring; reload, gateway restart and next turn retain the reduced measurement; canonical messages remain available.
- Actual Space Bunny Free verification: synthetic oversized conversation, real provider summary and response, live usage and reload/next-turn checks. See `docs/evals/2026-10-01/compaction-live-receipt.json` for the measured counts and labels.

Compaction does not promise a specific 32k target. The amount retained depends on the model budget, system/tool instructions, summary and recent messages. The displayed count must reflect those retained inputs rather than remain at the pre-compaction maximum.
