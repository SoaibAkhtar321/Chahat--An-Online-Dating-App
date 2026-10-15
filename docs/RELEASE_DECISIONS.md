# Release Decisions (needs owner approval)

## 1. Android package ID and URL scheme

Current: package `com.milo.dating`, iOS bundle `com.milo.dating`, URL scheme `milo`
(`mobile/app.json`). The package ID is **permanent once the first build is uploaded to Google Play**.

| Option | Effect |
|---|---|
| A. Keep `com.milo.dating` | No code change. Play listing shows the app name "Chahat" but the ID carries the old brand permanently. |
| B. Change to a Chahat ID (for example `com.<company>.chahat`, owner picks) | Cleanest for launch. Must update: `mobile/app.json` (android.package, ios.bundleIdentifier, scheme), `PACKAGE_NAME` in `supabase/functions/verify-purchase/index.ts`, Play Console app, Play products, and any Google Cloud OAuth config. Safe to do **only before** the first Play upload. |

Not decided. No ID change has been made.

## 2. EAS project

`mobile/app.json` has `owner: chahat-org` and an EAS project ID. Confirm the owner account is the
one the client will keep after handover.
