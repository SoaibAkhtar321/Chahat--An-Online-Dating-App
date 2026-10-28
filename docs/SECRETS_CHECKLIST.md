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
| `EXPO_PUBLIC_FEATURE_CALLS` | `true` shows call actions | Video calls |
| `EXPO_PUBLIC_AGORA_APP_ID` | Agora App ID (an identifier, not a secret). The production build is blocked if calls are on and this is not 32 hex characters (`mobile/scripts/check-release-env.js`) | Video calls |
| `EXPO_PUBLIC_FEATURE_VOICE_MESSAGES` | `true` shows voice notes | Voice messages |
| `EXPO_PUBLIC_FEATURE_COIN_TOPUP` | `true` shows coin top-up. **Keep `false`**: no purchase adapter or coin pack exists yet (`docs/BILLING.md`) | Coin purchases |

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
| `MEDIA_CLEANUP_SECRET` | cleanup-chat-media | Shared secret (`x-cleanup-secret` header) the scheduler sends to authorize chat-media cleanup |
| `GOOGLE_VISION_API_KEY` | moderate-photo | Image moderation |
| `CALL_PROVIDER` | issue-call-token | `agora`. Unset means calling is reported as not configured (503) |
| `AGORA_APP_ID` | issue-call-token | Same App ID as `EXPO_PUBLIC_AGORA_APP_ID` (same Agora project) |
| `AGORA_APP_CERTIFICATE` | issue-call-token | Agora App Certificate. Server only; signs the short-lived per-call tokens. The Agora project must have the certificate (token authentication) ENABLED, otherwise channels can be joined without tokens and the call-time limits do not bind |
| `AGORA_NCS_SECRET` | agora-ncs | Signing Secret of the Agora RTC webhook (Agora Console → Webhooks). Optional: only needed to reconcile the call allowance with Agora join/leave events (`app_settings.call_agora_reconcile_enabled`) |
| `COIN_PURCHASE_ADAPTER` | (future coin purchase function) | Name of the registered coin purchase adapter. Unset means coin purchases are not configured. No adapter ships yet; nothing reads it in production today |

Added with a real call adapter (not yet read by any code): that provider's credentials, for
example an app id and a signing certificate, set as Edge Function secrets only. A coin purchase
adapter likewise needs its own store credentials as Edge Function secrets, plus a server-side coin
catalogue (packs and prices need explicit approval). Billing rates are NOT secrets: they live in
`app_settings` (see `docs/BILLING.md`) and are changed only by an administrator with database access.

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

## Package name configuration

`ANDROID_PACKAGE_NAME` can be optionally configured in Supabase Edge Function secrets if targeting an alternative package ID (defaults to `com.chahat.dating` if unset). It is read by both `verify-purchase` and `google-play-notifications`. Must remain in sync with `mobile/app.json`.
