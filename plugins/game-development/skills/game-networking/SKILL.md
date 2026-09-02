---
name: game-networking
description: Design, implement, test, secure, and profile multiplayer game networking across engines, including authority, replication, prediction, rollback, lobbies, reconnects, and adverse network conditions.
---

# Game networking

## Establish the network contract

Identify the engine and transport, topology, authority model, tick rate, maximum players, matchmaking or lobby flow, session ownership, persistence boundary, platform services, trust boundary, and latency target. Trace one complete player action from local input through simulation, transport, authoritative resolution, replication, and remote presentation.

## Architecture rules

- Keep authoritative game state distinct from predicted and rendered state.
- Send player intent rather than trusting client-computed outcomes.
- Define ownership, relevance, reliability, ordering, and update frequency for each replicated value.
- Bound message sizes, queue growth, retries, entity counts, and reconnect history.
- Make protocol and saved-state compatibility explicit before changing serialized messages.
- Keep fixed simulation time separate from render frame rate and network arrival time.
- Treat names, chat, lobby metadata, remote procedure calls, and custom payloads as untrusted input.
- Never expose server secrets, platform credentials, administrative commands, or private player data to clients.

## Player experience

Choose interpolation, extrapolation, client prediction, reconciliation, lag compensation, or rollback according to the game mechanic rather than applying every technique globally. Preserve responsive local feedback while making corrections bounded and observable. Design join, leave, host migration, reconnect, timeout, version mismatch, and server shutdown states instead of treating disconnects as exceptional UI.

## Verification

1. Run deterministic simulation and protocol serialization tests.
2. Exercise two or more real clients against the normal server process.
3. Verify authority by sending invalid, duplicated, reordered, stale, oversized, and unauthorized actions.
4. Test join-in-progress, reconnect, timeout, full lobby, version mismatch, and graceful shutdown.
5. Inject representative latency, jitter, loss, duplication, reordering, and bandwidth limits.
6. Observe prediction error, correction distance, rollback depth, queue size, packet rate, bandwidth, server tick time, and memory.
7. Repeat the core loop in a packaged build on each platform network stack in scope.
8. Run a sustained session long enough to expose retained entities, abandoned connections, and growing buffers.

## Completion criteria

Report topology, authority, transport, server and client builds, player count, impaired-network matrix, security cases, reconnect behavior, measured bandwidth and frame or tick impact, and any platform service that could not be exercised.
