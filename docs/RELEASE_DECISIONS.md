# Release Decisions (needs owner approval)

## 1. Android package ID and URL scheme

**Decided (owner, Phase 3 session):** package and iOS bundle `com.chahat.dating`, URL scheme
`chahat`, Expo name `Chahat`, slug `chahat`. The previous values were `com.milo.dating` and `milo`.

Consequences:

- A different application ID is a different Android app. It will **not** update an app already
  published as `com.milo.dating`. This is safe only because no build has been uploaded to Google
  Play under the old ID. The ID is permanent once the first build is uploaded.
- Existing internal/preview builds installed as `com.milo.dating` stay separate apps; their
  `milo://` email links will no longer be accepted by the server allow-list.
- `PACKAGE_NAME` in `supabase/functions/verify-purchase`, `supabase/functions/google-play-notifications`
  and `policy.ts` now expects `com.chahat.dating`. Play Console and any Play products must be created
  under the new ID.
- Manual external steps (not changed by this repository): update the Supabase Auth Site URL and
  Redirect URLs to `chahat://` and `chahat://callback` for project `milo-dev`; update any Google OAuth
  redirect configuration; create the Play Console app with `com.chahat.dating`.
- The GitHub repository name (`Milo-Prototype-Baseline`), the Supabase project name (`milo-dev`) and
  historical migrations intentionally keep the old name.

## 2. EAS project

`mobile/app.json` has `owner: chahat-org` and an EAS project ID. Confirm the owner account is the
one the client will keep after handover.
