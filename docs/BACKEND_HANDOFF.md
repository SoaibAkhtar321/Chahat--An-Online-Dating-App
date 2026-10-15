# Chahat: backend handoff

The current repository contains both the **web prototype** (TanStack Start + React) and the **Native Android mobile application** (`/mobile` directory, built with React Native + Expo SDK 52 + TypeScript).
Real accounts (email auth), profiles, photos, Likes, Matches, chats, blocks and reports use Supabase. Daily Like limits are enforced in IST by `record_swipe`; the client reads the same setting from `get_daily_like_quota`. DOB is locked after initial save. Account deletion now marks the profile suspended before recursive storage cleanup and database purge, then deletes the Auth user last. These Phase 7-9 changes are local-only until their migration and Edge Function are deployed. Admin dashboard remains a web-only interface.

## 1. Proposed service boundaries

| Area            | Prototype today                                                                                                                                                                                          | Production responsibility                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth            | Expo Supabase Auth; SecureStore-backed native sessions; PKCE email callback for confirmation and password recovery                                                                                       | Keep sessions in platform secure storage, validate deep links, enforce 18+ at the database boundary, rate-limit login and recovery                                                       |
| Profiles        | `me` object per account                                                                                                                                                                                  | `profiles`, `profile_photos`, `profile_languages`, `profile_interests`, `voice_intros` tables; server validation of lengths, age, allowed values                                         |
| Images & audio  | Canvas-compressed data URLs                                                                                                                                                                              | Upload to cloud object storage via signed URLs; server re-encodes, strips EXIF/GPS, generates thumbnails; moderation queue                                                               |
| Discovery       | Client filter over 6 sample profiles                                                                                                                                                                     | Server query: opposite-sex, age/distance (rounded geohash, never exact coordinates), blocks, suspensions, deleted, visibility/incognito, language filter only when chosen, Boost ranking |
| Likes / Matches | `swipe()` + `likesYou` flag                                                                                                                                                                              | `swipes` table with a unique (from,to) constraint; match created only by a server transaction when both Likes exist; daily Like and Priority Like quotas enforced server-side            |
| Chat            | Local messages, simulated replies                                                                                                                                                                        | Realtime messaging service; only matched, unblocked pairs; image messages via storage; read receipts and online status respect privacy settings                                          |
| Moderation      | Reports, review signals, admin actions in browser                                                                                                                                                        | `reports`, `moderation_actions`, `verification_requests`, `audit_log`; heuristics are review signals only, never automatic bans                                                          |
| Premium         | `plans` config + `can()`                                                                                                                                                                                 | Plan/entitlement tables; entitlements derived from **server-verified** store purchases; every gate re-checked on the server                                                              |
| Calls           | Simulated timer, consent sheet                                                                                                                                                                           | Video provider (tokens minted server-side); server-side call metering from provider webhooks; free-minute rule, region rate and consent recorded before any paid second                  |
| Notifications   | Account-scoped local preferences/inbox; no seeded engagement notices or synthetic push tokens. Real-token registration calls the optional `push_devices` RPC when its migration is present.              | Server events → in-app inbox + push; respect account preferences; deduplicate; never fabricate engagement                                                                                |
| Admin           | `/admin` requires a signed-in account with the admin role (`user_roles`); Live tabs use server functions that re-check the role and write `admin_audit`. Plan/pricing/rules tabs are still browser-local | Separate admin app with role-based access (`user_roles` table), server authorization on every action, full audit log                                                                     |

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
- Block isolation: enforced at database level across profile RPCs (get_public_profile), chat messages (is_match_member, get_match_messages), matches RLS, and storage objects (chat_folder_member). Automatic database trigger (on_block_cleanup) on public.blocks cascades removal of matches and swipes transactionally upon block insertion.
- Verification protection: authoritative verification status cannot be self-approved by client; guarded by account_state_guard trigger in database and client-side sanitization.
- Account deletion: remove profile from all views immediately, purge storage objects via delete-account Edge Function with retryable error boundaries, purge database rows via service_role purge_user_data (including photo_reviews), keep only legally required records for a defined period; data export on request.
- Deletion migration: active entitlements are removed, subscription order evidence is retained with `user_id = NULL`, and report/audit identities are pseudonymized. Report notes and retention periods still require a privacy-policy/legal decision.
- Billing: Google Play checkout and the mobile purchase verifier remain disabled. The shipped `verify-purchase` Edge Function fails closed with HTTP 503 until the authoritative provider verifier is integrated and configured; static plan prices are not localized Play quotes.
- Paid feature checks remain authoritative in SQL/RLS/RPCs. UI-only Boost simulation is disabled; a provider-backed server feature is required before it can be offered as active.
- Production release: EAS production builds require environment-scoped public Supabase URL/key values, a version increment, and a Play submission credential kept outside Git. Hosted Auth redirect allowlists must include `milo://callback`.
- Backups: daily database backups with point-in-time recovery; storage versioning; tested restore.
- Legal: Terms, Privacy Policy and Community Guidelines in the app are drafts for legal review (India DPDP Act, IT Rules grievance officer).

## 4. Out of scope / not recommended

- Automatic customer-care calls after a suspected uninstall are **not implemented**. If ever pursued, it needs explicit opt-in consent, a feasibility check (uninstall detection is unreliable) and legal/privacy review.

## 5. Costs to evaluate before production

Hosting/database, object storage + CDN bandwidth, video minutes, SMS OTP per message, email volume, push (free tier), verification provider per check, Google Play service fee (15–30%), monitoring/error tracking.

## 6. Decisions still pending client approval (configurable in Admin)

The current server-configured daily Like limit is 20 per IST day; the client reads it from the backend rather than hard-coding it. Boost and provider-backed push registration require integration before launch. Product/provider catalog localization, call free-minute rule, call rates, and legally required account-retention periods still need confirmation.
