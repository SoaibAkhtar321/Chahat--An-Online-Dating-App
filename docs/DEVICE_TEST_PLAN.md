# Chahat two-account device test plan (6.6)

Every row is **NOT TESTED** until you run it on a real Android device and record the result.
Nothing here has been executed. Jest, SQL tests and static analysis do not count as device results.

Setup: two physical Android devices (A, B; one on Android 13+), two accounts (User A, User B; B is Premium for likes tests),
a build with `EXPO_PUBLIC_FEATURE_CALLS=true` and `EXPO_PUBLIC_FEATURE_VOICE_MESSAGES=true` pointed at a staging project that has
all migrations through `20260101004600` applied, Edge Function secrets set (`CALL_PROVIDER=agora`, `AGORA_APP_ID`,
`AGORA_APP_CERTIFICATE`), and `google-services.json` in the build.

Status values: PASS / FAIL / BLOCKED / NOT TESTED. Fill "Actual" yourself.

| # | Area | Steps | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | Signup/verify | Sign up User A with email; enter OTP | Account created, lands in onboarding | | NOT TESTED |
| 2 | Email link | Request a link, open on device | App opens, session set; Site URL and redirect correct | | NOT TESTED |
| 3 | Email verify back | On verify screen press hardware back, then repeat via "Back to log in" | Both clear signup credentials and go to login; back ignored while a code is verifying | | NOT TESTED |
| 4 | Onboarding | Complete profile, DOB, legal acceptance | Underage DOB rejected; legal acceptance required | | NOT TESTED |
| 5 | Location allowed | Choose "Use current location", allow | City chosen; no exact coordinates shown | | NOT TESTED |
| 6 | Location denied | Deny once | Clear message, manual search still works | | NOT TESTED |
| 7 | Location permanently denied | Deny with "don't ask again" | "Open settings" offered | | NOT TESTED |
| 8 | Location services off | Turn device location off | Clear message, manual path works | | NOT TESTED |
| 9 | Manual search / chip | Search a city; tap a popular chip; switch modes | Selection updates; "Selected city" shown | | NOT TESTED |
| 10 | Location persistence | Change city in Settings, kill app, reopen | City persisted | | NOT TESTED |
| 11 | Location back | Change city, press hardware back | Saved immediately; back behaves like header back | | NOT TESTED |
| 12 | Photo | Pick photo; Done / Crop / Undo | Each works; Undo restores | | NOT TESTED |
| 13 | Verification selfie | Take selfie, press hardware back, then header back | "Discard selfie?" prompt both ways; blocked during upload; exits when pending/approved | | NOT TESTED |
| 14 | Discover | Open Discover as A | Nearby cities first; widening distance shows farther ones; blocked users absent | | NOT TESTED |
| 15 | Like and match | A likes B, B likes A | Match created, both notified | | NOT TESTED |
| 16 | Likes teaser | Free account opens Likes | No count, no identities. Premium sees them | | NOT TESTED |
| 17 | Push | Match/message push from foreground, background, killed | Tap opens right screen; duplicate taps do nothing; lock screen text generic | | NOT TESTED |
| 18 | Notification permission | Android 13+ fresh install | Consent notice first, then OS prompt once; deny leaves app usable; "Open settings" offered | | NOT TESTED |
| 19 | Notification settings | Toggle each preference | Respected by pushes | | NOT TESTED |
| 20 | Chat | Send text both ways | Delivered in order | | NOT TESTED |
| 21 | Delete for me | A deletes a message for self | Gone for A only | | NOT TESTED |
| 22 | Delete for everyone | A deletes for everyone | Gone for both; media inaccessible | | NOT TESTED |
| 23 | Chat image | Send image; tap it | Known: no viewer exists (plain image), nothing to back out of | | NOT TESTED |
| 24 | Screenshot/recording | Screenshot and screen-record chat | Blocked or blank per `docs/SCREENSHOT_PROTECTION.md` | | NOT TESTED |
| 25 | Voice: permission denied | Deny mic | Clear message, no crash | | NOT TESTED |
| 26 | Voice: cancel / send / play | Record, cancel; record, send; B plays | Each works | | NOT TESTED |
| 27 | Voice: expired URL | Play an old voice message after the signed URL expires | Fresh URL fetched or clear error | | NOT TESTED |
| 28 | Audio call | A calls B, join, mute/unmute | Audio both ways; toggle works | | NOT TESTED |
| 29 | Video call | Video call; camera toggle | Video both ways; toggle works | | NOT TESTED |
| 30 | Hang up | Hang up from A, then repeat from B | Other side ends cleanly | | NOT TESTED |
| 31 | Token renewal | Stay in a call longer than the first token lifetime | Call continues past renewal | | NOT TESTED |
| 32 | Incoming: foreground | B in app, A calls | Ringing overlay; Answer/Decline work; cancel stops ring | | NOT TESTED |
| 33 | Incoming: background | B backgrounded | High-importance notification; Answer opens app; Decline does not | | NOT TESTED |
| 34 | Incoming: killed | B killed | Notification may appear; Answer/Decline from killed state and full-screen intent are NOT guaranteed (known limit) | | NOT TESTED |
| 35 | Call cleanup | Cancel, decline, expire, sign out, switch account | Notifications cleared in each case | | NOT TESTED |
| 36 | Hardware/gesture back | Every screen incl. tabs, chat, settings, onboarding | Equals header back; unsaved prompts where meaningful | | NOT TESTED |
| 37 | Logout/login | Log out, log in as other user | No data from previous account | | NOT TESTED |
| 38 | Delete account | Delete User A | Signed out, data/media cleaned, login fails | | NOT TESTED |
| 39 | Full journey | Signup, verify, onboarding, location, photo, Discover, like, match, chat, delete messages, voice, video call, logout, login, delete account | All steps succeed | | NOT TESTED |
| 40 | Help & Support | Settings > Help & Support; tap the email | Screen shows email and address; tap opens the mail app with subject filled | | NOT TESTED |
| 41 | Hidden distance paging | A hides distance; B scrolls Discover past A | A shows no distance; paging has no repeats or gaps | | NOT TESTED |
