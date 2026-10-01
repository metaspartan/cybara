# Import browser data

Open the **Browser** workspace in a chat, then choose **Import browser data** in the banner above the address bar. Dismissing the introductory banner hides it entirely. You can always reopen import or manage the library from **Settings → Safety → Browser data**. There is no automatic bottom-corner browser popup.

The same modal is available from **Settings → Safety → Browser data → Import browser data**, even without an active chat or browser tab. **Manage imported data** opens the encrypted library. **Restore browser banner** makes the top banner visible again. Visit pages and fill logins from the Browser workspace.

The modal lets you select a browser profile or exported files, choose individual categories, and confirm consent before anything is imported. Original browser data is not modified.

## Supported data

| Data | Detected local profile | Exported file | How it is used |
| --- | --- | --- | --- |
| Bookmarks | Chrome, Edge, Brave, Chromium | Browser bookmarks HTML; Chromium bookmarks JSON; JSON list of `url` and `title` | Search and open links under **Imported data** |
| Browsing history | Chrome, Edge, Brave, Chromium | JSON list of `url`, `title`, and `visited_at` or `lastVisitTime` in epoch milliseconds | Search and open visited pages under **Imported data** |
| Saved passwords | Not read directly from protected browser databases | Password CSV containing `url`, `username`, and `password` columns, as exported by Chrome, Edge or Firefox | Select **Fill login** on a matching website; review and submit the form yourself |
| Cookies | Not read directly from protected browser databases | Cookie JSON array (or an object containing `cookies`); Netscape tab-separated cookie file | Applied to the local embedded browser and restored when it creates a new local context |

Browser profiles are detected at standard locations on Windows, macOS and Linux. If history is locked or its snapshot cannot be read, close the source browser and retry. The modal reports errors rather than claiming a successful import.

Each export must be at most **8 MiB**, with at most **10,000 records** per category. Imports are deduplicated; importing the same saved login or link updates the existing record. The encrypted library has a 32 MiB size limit. The library displays up to 500 history entries and bookmarks, with search over those displayed records.

## Password export

Export passwords from the source browser's password-manager settings, select **Saved passwords**, and choose the CSV file. The export is plaintext: remove it from your device when you no longer need it. Cybara does not bypass operating-system encryption or application-bound browser credential protections.

Imported passwords are encrypted at rest using Cybara's existing credential storage. The library exposes only the website and username. It never returns password values to the UI. Filling is user-triggered, checks the exact scheme, hostname and port, and refuses forms that submit to a different origin. It never submits a form automatically. Once filled, the website and browser automation can access the field, so only fill credentials on trusted sites.

## Cookie exports

Only import cookie exports you trust. Cookies may grant agents access to signed-in accounts. Expired cookies are not applied. Secure, HttpOnly and SameSite settings are preserved. Some sites bind sessions to the original browser, require extra storage beyond cookies, or expire sessions server-side; importing cookies cannot guarantee that you remain signed in.

Cookie import and password filling are restricted to a local Cybara-owned embedded browser. They do not inject credentials into a remote browser or a separately connected personal browser.

## Privacy and limits

Import endpoints require a local connection and the root gateway API key; localhost bypass and mobile-device credentials do not grant access. Import is not exposed as an agent tool. Imported data, including history and bookmarks, is encrypted on the gateway device. No browser database credentials are decrypted during source detection or profile import.

Browsing history is a library, not a recreation of a tab's Back/Forward stack. Extensions, browser settings, payment details, synced accounts, local storage and IndexedDB are not imported. The embedded browser's imported library is separate from named browser profiles used by advanced browser tools.
