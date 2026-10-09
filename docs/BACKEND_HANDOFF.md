# Milo: pre-backend handoff note

The current app is a **web prototype** (TanStack Start + React). It is not the Android app. The production plan is a **React Native + TypeScript Android app** (iOS later) with a trusted backend. Stage 4: accounts (email + Google sign-in), profiles, photos, Likes, Matches, chats (live), blocks and reports are now stored in Lovable Cloud (`src/lib/milo-cloud.ts`, server rules in the database). Premium, calls, notifications, verification review and admin remain browser-local demos. Still to move: daily Like limit enforcement on the server, admin tools on real accounts.

## 1. Proposed service boundaries
| Area | Prototype today | Production responsibility |
|---|---|---|
| Auth | Demo email + hashed password in the browser | Managed auth (email OTP / phone OTP, Google). Server-issued sessions, 18+ check on DOB at signup, rate-limited login/OTP |
| Profiles | `me` object per account | `profiles`, `profile_photos`, `profile_languages`, `profile_interests`, `voice_intros` tables; server validation of lengths, age, allowed values |
| Images & audio | Canvas-compressed data URLs | Upload to cloud object storage via signed URLs; server re-encodes, strips EXIF/GPS, generates thumbnails; moderation queue |
| Discovery | Client filter over 6 sample profiles | Server query: opposite-sex, age/distance (rounded geohash, never exact coordinates), blocks, suspensions, deleted, visibility/incognito, language filter only when chosen, Boost ranking |
| Likes / Matches | `swipe()` + `likesYou` flag | `swipes` table with a unique (from,to) constraint; match created only by a server transaction when both Likes exist; daily Like and Priority Like quotas enforced server-side |
| Chat | Local messages, simulated replies | Realtime messaging service; only matched, unblocked pairs; image messages via storage; read receipts and online status respect privacy settings |
| Moderation | Reports, review signals, admin actions in browser | `reports`, `moderation_actions`, `verification_requests`, `audit_log`; heuristics are review signals only, never automatic bans |
| Premium | `plans` config + `can()` | Plan/entitlement tables; entitlements derived from **server-verified** store purchases; every gate re-checked on the server |
| Calls | Simulated timer, consent sheet | Video provider (tokens minted server-side); server-side call metering from provider webhooks; free-minute rule, region rate and consent recorded before any paid second |
| Notifications | In-app notice list | Server events → in-app inbox + push (FCM) + transactional email; respect preferences; deduplicate; no fabricated engagement |
| Admin | `/admin` requires a signed-in account with the admin role (`user_roles`); Live tabs use server functions that re-check the role and write `admin_audit`. Plan/pricing/rules tabs are still browser-local | Separate admin app with role-based access (`user_roles` table), server authorization on every action, full audit log |

## 2. Integration points (providers not chosen yet)
- **Payments:** Google Play Billing for subscriptions and one-time packs; server-side purchase token verification and Real-time Developer Notifications for renewals/cancellations/refunds. Per-minute call billing must be checked against Google Play policy before launch.
- **Video calls:** a WebRTC provider (e.g. Agora, 100ms, LiveKit, Twilio). Needs token endpoint, webhooks, recording disabled by default.
- **Push:** Firebase Cloud Messaging.
- **OTP / email:** SMS OTP provider (India DLT registration needed) and a transactional email provider.
- **Verification:** optional selfie/liveness provider; badge only after a completed review.

## 3. Security, privacy and operations
- Secrets only in server environment variables (never in the app bundle). Expected: auth keys, storage keys, payment service account, video provider key/secret, FCM key, SMS/email keys, webhook signing secrets.
- Rate limiting on auth, OTP, likes, messages, reports and uploads.
- Row-level access rules: users read only their own private data; public profile fields only for eligible viewers.
- Account deletion: remove profile from all views immediately, delete media, keep only legally required records for a defined period; data export on request.
- Backups: daily database backups with point-in-time recovery; storage versioning; tested restore.
- Legal: Terms, Privacy Policy and Community Guidelines in the app are drafts for legal review (India DPDP Act, IT Rules grievance officer).

## 4. Out of scope / not recommended
- Automatic customer-care calls after a suspected uninstall are **not implemented**. If ever pursued, it needs explicit opt-in consent, a feasibility check (uninstall detection is unreliable) and legal/privacy review.

## 5. Costs to evaluate before production
Hosting/database, object storage + CDN bandwidth, video minutes, SMS OTP per message, email volume, push (free tier), verification provider per check, Google Play service fee (15–30%), monitoring/error tracking.

## 6. Decisions still pending client approval (configurable in Admin)
Free daily Likes (10), Boost length (30 min), Priority Likes/day (3), plan contents and prices for Premium Plus/Pro, one-time pack prices, free-minute rule (per call), behaviour when only one caller has Premium, country call rates (test rate only), relationship intention options.
