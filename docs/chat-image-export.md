# Copy and save chat images

Open an image thumbnail or a **Viewed an image** preview, then right-click the image for **Copy image** and **Save image as…**. The image viewer's **Download image** button uses the same authenticated save path. These actions remain available while the agent is working.

## Desktop

The Tauri desktop client copies decoded PNG pixels through a native clipboard command rather than relying on WebView clipboard permissions. JPEG, WebP, GIF and other browser-decodable images are converted to PNG for clipboard compatibility. Saving uses the native save dialog and preserves the source image bytes and format.

The desktop permission grants are limited to the existing trusted Cybara windows/origins. Image input and decoded pixel dimensions are bounded; unsupported/malformed data and mismatched save extensions are rejected. The gateway's media authentication and path confinement remain unchanged.

## Web

Copy uses the browser clipboard API directly from the user's menu click. If clipboard access is explicitly denied, Cybara explains how to allow it and keeps **Save image as…** available. Clipboard availability still depends on the browser's secure-context and permission rules; the app does not bypass them.

Saving creates a download from authenticated image bytes, rather than navigating an unauthenticated media URL. Existing viewed-image bytes are reused, including when the viewer stays open through chat updates. Base64 and percent-encoded inline images are decoded locally rather than fetched through a CSP-blocked data URL.

## Verification

- Rendered browser tests open a real chat thumbnail while a chat turn is active, click the actual context menu, read back clipboard PNG pixels, and compare downloaded bytes.
- A denied clipboard Permissions-Policy test verifies actionable feedback and a successful save fallback.
- Windows native verification runs an isolated Tauri/WebView2 host with the real IPC permission manifest, clicks the same menu, reads system-clipboard pixels, completes the actual Save dialog, and checks the saved file bytes.
- Native unit tests reject malformed base64, non-PNG or incomplete payloads, excessive dimensions and invalid save paths. A separate host clipboard probe confirms exact pixel round trips.

Desktop command and permission changes require a rebuilt desktop application. Updating only the gateway's UI bundle does not add the native clipboard command to an older installed shell.
