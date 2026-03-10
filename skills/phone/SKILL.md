---
name: phone
description: Make phone calls on macOS using FaceTime
metadata: {"cybara":{"emoji":"📞","skillKey":"phone"}}
---

# Phone

Make phone calls on macOS using FaceTime. This tool uses the native macOS `tel:` URL scheme to open FaceTime and initiate calls.

## Requirements

- macOS (the tool will return an error on other platforms)
- FaceTime app installed and signed in

## Tool

Use `phone` for agent-initiated calls.

### Actions

- `call` - Initiate a phone call to the specified number
- `check` - Check if FaceTime is available on this Mac

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| action | string | Yes | Action to perform: "call" or "check" |
| phone | string | For call action | Phone number to call (E.164 format recommended, e.g., +15551234567) |

### Examples

```json
{
  "action": "call",
  "phone": "+15551234567"
}
```

```json
{
  "action": "check"
}
```

### Response

The tool returns a JSON object with:
- `success`: boolean indicating if the call was initiated successfully
- `callId`: unique identifier for the call (if successful)
- `message`: status message
- `method`: method used ("facetime" for successful calls)

## Notes

- This tool only works on macOS
- The call is initiated through FaceTime, which must be signed in with an Apple ID
- The agent cannot control the call once initiated (no hangup, mute, etc.)
- For more advanced voice calls with two-way conversation, see the `voice-call` skill which supports VoIP providers like Twilio, Telnyx, and Plivo

## Security Considerations

- Phone calls are logged in the system
- The tool requires user interaction to actually place the call (FaceTime must be opened)
- Consider privacy implications when making calls through automated agents
