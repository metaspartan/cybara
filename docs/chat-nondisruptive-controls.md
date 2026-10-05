# Non-disruptive chat steering and agent selection

## Steering

Steer promotes a pending follow-up into a durable steering item without aborting the active chat controller. It is consumed at the next supported model/tool boundary. An executing command, child run or provider request is allowed to finish; a tool or model blocked for a long time will not receive the new instruction until it reaches a safe point.

If the current turn finishes before consuming the instruction, the follow-up runs as the next queued turn. The queue remains visible until consumption and survives reload. Acknowledgement returns `steeringQueued: true`; the UI does not fabricate an interrupted assistant message, finalize executing activities, or reload/reset the live run merely because steering was requested.

This is a user instruction for the parent conversation, not an instruction to rewrite or cancel a child's task. Accepted child jobs keep their independent cancellation controller and original assignment. Explicit child Stop and timeouts retain their normal meaning. Parent Stop remains a deliberate cancellation operation; this change does not silently convert it into steering.

## Selecting another agent

Selection no longer aborts the active turn. The requested agent/router update is serialized at the next turn boundary. The current agent completes its work with the same permissions and instructions, then the selection is applied and persisted. During this interval the selector is pending/disabled, with an explanatory tooltip; active chat controls and child runs remain available.

Queued follow-ups that inherited the previous selection are retargeted to the new agent/router mode, including persisted pending requests. An explicitly different queued agent is retained. The new selection is used for subsequent turns, not a mid-tool replacement of the currently executing identity. An invalid agent request cannot stop the ongoing turn.

## Verification

Deterministically gated integration tests cover zero, one and two independently running child jobs; steering during the active parent; a pending agent switch; child completion after the parent switch; persistence; follow-up routing; router mode; and invalid selection. Existing explicit-stop, queue ordering, vision-stop, ownership transfer and pending-durability tests remain active.

A rendered browser test uses an isolated gateway and real HTTP provider fixture. It clicks Steer and selects another agent while the parent and child requests are blocked, verifies neither request is aborted, observes the pending selection and active Stop control, releases the parent, and verifies the child completes normally and the follow-up uses the selected model. This is lifecycle testing, not a live-model accuracy benchmark.

The live installed gateway is not restarted by these tests. Source changes need deployment or an application update before affecting that installation.
