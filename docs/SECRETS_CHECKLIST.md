# Chahat Secrets and Credentials Checklist

Names and purposes only. **Never commit values.** Attach each item only when you are ready to turn
its feature on. Until then the feature stays hidden or disabled (flags default to OFF).

## A. EAS build environment (client-visible, public by design)

Set in the EAS **production** environment (`eas env:create` or the expo.dev dashboard).
A production build is blocked by `mobile/scripts/check-release-env.js` if the first two are missing.

| Name | Purpose | Turns on |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL | Whole app backend |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key | Whole app backend |
| `EXPO_PUBLIC_FEATURE_BILLING` | `true` shows Google Play purchase flow | Subscriptions |
| `EXPO_PUBLIC_FEATURE_PUSH` | `true` registers devices for push | Push notifications |
| `EXPO_PUBLIC_FEATURE_CALLS` | `true` shows call actions | Audio/video calls |
| `EXPO_PUBLIC_FEATURE_VOICE_MESSAGES` | `true` shows voice notes | Voice messages |
| `EXPO_PUBLIC_FEATURE_COIN_TOPUP` | `true` shows coin top-up | Coin purchases |

Flags must be the exact string `true` to enable. Anything else is OFF.

## B. Supabase Edge Function secrets (server only)

Set with `supabase secrets set NAME=value` against the target project. `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase automatically.

| Name | Function | Purpose |
|---|---|---|
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | verify-purchase, google-play-notifications | Play Developer API service account (full JSON). Alternative: `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY` (verify-purchase only) |
| `PUBSUB_PUSH_AUDIENCE` | google-play-notifications | Audience the Pub/Sub push subscription signs for |
| `PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL` | google-play-notifications | Service account that signs the Pub/Sub push |
| `PUSH_DISPATCH_SECRET` | dispatch-push | Shared secret the scheduler sends to authorize dispatch |
| `GOOGLE_VISION_API_KEY` | moderate-photo | Image moderation |

Added by later phases (placeholders, not yet read by code): call provider keys, coin top-up
product configuration.

## C. Files and consoles (not environment variables)

| Item | Where | Purpose |
|---|---|---|
| `google-services.json` | `mobile/google-services.json` (gitignored) or EAS file variable `GOOGLE_SERVICES_JSON` | Firebase Cloud Messaging for Android push; see `docs/PUSH_SETUP.md` |
| FCM credentials | EAS credentials | Delivers Expo push to Android |
| Play Console products | Play Console | Product IDs must match `PLAY_PRODUCT_IDS` in `mobile/src/services/subscription.ts` |
| License testers | Play Console | Test purchases |
| Pub/Sub topic and push subscription | Google Cloud | Real-time subscription notifications |
| Play service account access | Play Console | Grants the service account API permission |
| Release keystore | EAS credentials | App signing |

## Known hardcoded value

`supabase/functions/verify-purchase/index.ts` hardcodes `PACKAGE_NAME = "com.milo.dating"`.
If the package ID changes (see `docs/RELEASE_DECISIONS.md`), this must change with it, along
with `mobile/app.json`. Phase 6 moves this into configuration.
