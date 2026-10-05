# Compact computer-use activity notice

“Cybara is using your computer” is a compact, non-modal notice rather than a full-screen takeover dialog. Other chat controls remain usable; no backdrop, focus trap or global Escape interception is added. The notice exposes Stop and a separate dismiss control. Dismiss hides the notice for the current session/run without cancelling its task. Escape dismisses only when focus is inside the notice.

The notice is movable so it can sit clear of open panels. Drag the labelled title grip with the pointer; the focused grip also moves with the arrow keys (hold Shift for larger steps), and double-click restores the default corner. The chosen position persists across notices and is clamped so the notice always stays fully inside the viewport, including after a window resize. Stop and dismiss never move or resize the notice.

Stop hides the notice immediately and invokes the normal chat Stop handler. Active/stopping state and session/run identity gate visibility. Null or failed status polls clear the notice immediately; session changes abort the old request. Polls are serialized and aborted on cleanup, so a delayed response cannot restore a stopped or dismissed notice. A new run can display a new notice.

The old repeated-null hide timer was longer than the polling interval and restarted on every poll, preventing reliable removal. That timer is removed.

Server-side Stop clears focus state immediately even without an active recording or chat controller. Normal/error turn finalization and session deletion clear only their own focus state, preserving unrelated sessions. Computer-use tools reject an already-aborted signal and clear any focus left behind by a late abort. This does not guarantee that a native action already dispatched to an external driver can be undone.

## Verification

A real browser test renders the actual component with built styles at1280px and390px. It exercises underlying buttons/text input, global Escape non-interception, dismiss without Stop, next-run reappearance, serialized held polling, immediate Stop, late response suppression, failed/null status, session changes and idle cleanup. The inspected1280×900 screenshot shows a small top-right notice with readable Stop and dismiss controls; its dark background belongs to the test fixture rather than an overlay backdrop.

Backend regressions cover focus with no recording, idempotent stop, active Stop, success/error finalization, deletion, pre-aborted tools and independent-session preservation. The actual installed desktop and live gateway were not restarted or replaced by this work; these source fixes require an application/gateway update to affect that installation.
