---
name: voice-call
description: Start and manage agent-driven voice calls on macOS through the `voice_call` tool.
metadata: {"cybara":{"emoji":"📞","skillKey":"voice-call"}}
---

# Voice Call

Use `voice_call` when an agent needs to place or manage a phone call.

## Backends

- `mode: "macos"` or `mode: "auto"` on macOS:
  Starts a FaceTime phone call and can play spoken prompts through the local system voice.
- `mode: "mock"`:
  Dry-run backend for tests, demos, and local verification without starting a real call.

## Tool

Use `voice_call` for agent-initiated call flows.

Actions:
- `check_support`
- `initiate_call`
- `continue_call`
- `speak_to_user`
- `end_call`
- `get_status`

Useful arguments:
- `to` or `phone`
- `callId`
- `message`
- `mode`
- `voice`
- `rate`

## Notes

- macOS mode is local-device call assistance, not a managed carrier/VoIP session.
- `initiate_call` starts the FaceTime call.
- `speak_to_user` / `continue_call` use the macOS `say` voice on the local machine.
- `end_call` closes FaceTime to end the active call.
- Use `mode: "mock"` when you need an agent workflow or test without placing a live call.
