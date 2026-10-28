# Profile sharing (2026-10-29)

Members can share a profile like on Instagram/LinkedIn:
* **Me tab → "Share my profile"**, and a **share button (top right)** on any profile screen.
* Options: **Copy link**, **WhatsApp**, **More options** (Android share sheet: Instagram, Telegram, SMS, Gmail…).
* Link: `https://chahatlegal.netlify.app/p/<member-id>`.

## What happens when someone taps the link
| Who taps it | Result |
|---|---|
| Chahat installed, signed in | App opens straight on the profile (normal visibility + block rules apply) |
| Chahat installed, signed out / not onboarded | App opens → login/onboarding → then the profile opens |
| No app | Web page "Someone shared a Chahat profile" with **Open in Chahat** / **Get it on Google Play** |

## Privacy
* The link contains only the member id: no name, photo, city or age.
* The web page shows **no** profile data (it never queries Supabase) and is `noindex`.
* Text when sharing someone else's profile is "Check out this profile on Chahat" (their name is never sent outside the app).
* Blocked members and removed accounts get "Profile not found" (get_public_profile rules, unchanged).

## Manual steps (needed for the link to open the app directly)
1. Website project (Chahat-admin-legal): copy `docs/profile-share-website/app/p/[id]/page.tsx` to `app/p/[id]/page.tsx`
   and `docs/profile-share-website/public/.well-known/assetlinks.json` to `public/.well-known/assetlinks.json`.
2. In `assetlinks.json` put the SHA-256 fingerprints:
   * Play Console → Test and release → App integrity → **App signing key certificate** SHA-256.
   * `eas credentials -p android` → the keystore SHA-256 (for preview/internal APKs).
3. Deploy the website; check `https://chahatlegal.netlify.app/.well-known/assetlinks.json` opens.
4. Build a new app (`eas build`), because a native module (`expo-clipboard`) and an intent filter were added.

Until steps 1–3 are done, the link opens the web page (with "Open in Chahat") instead of jumping straight into the app.
