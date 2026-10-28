# Chahat launch-readiness gap analysis — 2026-10-28 (base `4081917`)

Scope: the whole app — 30 screens in `mobile/app`, 63 migrations, 10 Edge Functions, 110 Jest suites, the SQL
suite. Evidence is either an automated test that ran here (named), a code location, or "external" (needs a
dashboard, device or account this environment does not have). Nothing was deployed, committed or pushed.

**Environment limits:** no Android SDK (no Gradle/EAS build), no device, no access to Supabase, Agora, EAS,
Google Play Console, GitHub Actions or the legal website (`chahatlegal.netlify.app` is not reachable from here).

**Status key:** ✅ implemented and verified · 🟡 implemented, not verified end-to-end (external dependency) ·
🟠 partially implemented · 🔴 broken · ⚪ not implemented.

## A. Release blockers (must be resolved before uploading to Play)

| # | Blocker | Evidence | Who |
|---|---|---|---|
| 1 | **Target API level.** Since 31 Aug 2026, Play accepts new apps and updates only if they target **Android 16 (API 36)** (extension to 1 Nov 2026 can be requested in Play Console). This project is on Expo SDK 52 / React Native 0.76, whose default `targetSdk` is **34** (`react-native/gradle/libs.versions.toml`), and `app.json` does not override it. An upload will be rejected. | developer.android.com/google/play/requirements/target-sdk; `mobile/app.json` (no `targetSdkVersion`) | Decision + build work: upgrade Expo SDK to a version that targets 36, **or** set `expo-build-properties` `compileSdkVersion`/`targetSdkVersion` 36 on SDK 52 and test (edge-to-edge layout changes). Not changed here: it cannot be built or tested without the Android SDK. Request the Play extension now. |
| 2 | **Operator / legal details are all placeholders** — operator name, address, support e-mail, Grievance Officer (required for an Indian intermediary), child-safety contact, retention periods, refund policy. The app shows "Not yet provided". | `mobile/src/constants/operatorDetails.ts` (11 bracketed values); `__tests__/legalPrivacyScreen.test.tsx` | Operator + legal review. Do not invent. |
| 3 | **15-day Plus plan** cannot be created in Play (no 15-day/2-week period). | Part 2 report §4 | Product decision |
| 4 | **Plan copy advertises features that are not paid or not built:** "Smart Icebreakers" and "Compatibility Score Summary" (listed under Premium) are shown to every user for free (`app/chat/[id].tsx`, `app/profile/[id].tsx`, no plan check); "Exclusive VIP Badge" is not implemented anywhere. Misleading purchase claims are a Play policy and consumer-law risk. | `mobile/src/services/subscription.ts` PLANS | Product decision: gate the features, build the badge, or remove the lines. Not changed (business copy). |
| 5 | External configuration (Agora certificate, Supabase secrets, EAS production env, Play products/service account/RTDN, scheduled jobs, FCM). | §C | Owner |
| 6 | Physical-device tests, real purchases, GitHub Actions run of this patch. | — | Owner |

## B. Fixed in this patch

| Issue | Severity | Fix | Evidence |
|---|---|---|---|
| Selfie verification was half built: users could submit, but there was no audited approval path and **no way for anyone else to see the badge** (feed/profile RPCs never return it), while the Safety Centre tells users to "look for the blue Verified badge". | 🟠 → ✅ (code) | `review_verification` (service_role, only `pending` can be approved, audited in `admin_audit`); `get_verified_profile_ids` (boolean badge only, visible/unblocked profiles, ≤100 ids); app shows the badge in Discover and on profiles from that list only. | `supabase/tests/76_verified_badge.sql` (11 checks), `__tests__/verificationBadges.test.ts` (4) |
| Two database errors shown to users said "Milo" ("You must be 18 or older to use Milo", "Contact Milo Support"). | Low (user-facing) | Same checks, Chahat wording. | `76_verified_badge.sql` brand check |
| Stale TODO in `googleAuth.ts`. | Cosmetic | Comment fixed. | — |

The approval UI itself (who reviews selfies, how fast) lives in the separate admin website / Supabase dashboard
and is **external**: call `review_verification(user_id, 'approved'|'rejected', reviewer_id, note)` as service_role.

## C. Feature inventory

### Authentication and onboarding
| Feature | Status | Evidence |
|---|---|---|
| Email sign-up / login / logout | 🟡 | `authLifecycle`, `authConfig` tests; Supabase Auth settings external (`docs/AUTH_SETTINGS_CHECKLIST.md`) |
| Email verification screen, back navigation | 🟡 | `verifyEmailBack` test; "Confirm email" must be ON in Supabase (external) |
| Password reset (deep link `chahat://`) | 🟡 | `app/(auth)/reset-password.tsx`; redirect URL allow-list external |
| Google sign-in | 🟡 | `services/googleAuth.ts`; Google provider + OAuth client in Supabase/Google Cloud external |
| 18+ age gate | ✅ | server `profiles_guard` (dob ≥ 18 y), `age` test, `10_functional_rls.sql` |
| Onboarding / profile completion (name, dob, photos, intents) | ✅ | `validate_profile_completion`, `streamlinedOnboardingAndProfileCompletion` test |
| Legal acceptance (terms/privacy versions) | ✅ | `51_legal_acceptances.sql`, `legalAcceptanceFlow`, `legalVersions` |
| Optional consents (location etc.) | ✅ | `52_optional_consents.sql`, `consent` test |

### Profiles and media
| Feature | Status | Evidence |
|---|---|---|
| Edit profile, column-level grants, DOB immutable | ✅ | `profileService`, `profileSelectGrants`, `37_profile_media.sql` |
| Photo upload, ownership paths, storage RLS | ✅ | `photoUpload`, `storageSecurity`, `20_storage_deletion.sql`, `55_storage_chat_ownership.sql` |
| Photo moderation (Google Vision) | 🟡 | `photoModerationPolicy`, `25_photo_reviews.sql`, `27_photo_visibility.sql`; needs `GOOGLE_VISION_API_KEY` (fails closed with 500 if missing) |
| Voice intro | ✅ | `voiceIntro` test, `20260101004750/5200` migrations |
| Selfie verification + badge | ✅ code / 🟡 review process | §B |
| Screenshot protection | ✅ | `screenProtection`, `screenProtectionLifecycle`, `chatScreenProtection` |

### Discovery, likes, matching
| Feature | Status | Evidence |
|---|---|---|
| Discover feed (global, distance-ordered, filters, cursor) | ✅ | `39_location_discovery.sql`, `62–65` suites, `discoveryRadiusFallback` |
| Swipe like/pass, daily like quota (IST), unlimited for paid | ✅ | `35_uniform_quota.sql`, concurrency "25 parallel likes", `quota` |
| Duplicate likes / matches under concurrency | ✅ | "15 parallel duplicate likes" |
| Who liked me / count (paid) | ✅ | `57_push_phase2_likes.sql`, `phase2LikesMigration`, `likesService` |
| "You liked" history (paid) | ✅ | `69_sent_likes.sql` |
| Rewind pass (paid, eligibility, concurrency) | ✅ | `72`, `75_allowance_concurrency.sh` |
| Location: GPS / city search / privacy | ✅ code / 🟡 device | `61`, `71`, `48_location_privacy.sql`, `gpsFix`, `locationPicker` |
| Explore / daily pick | 🟡 | `app/explore/index.tsx`; no dedicated test |
| Compatibility summary, icebreakers | ✅ works (free to all) — see blocker A4 | `compatibility` test |
| Advanced filters / priority visibility / incognito | ⚪ | client entitlement names only (`hasEntitlement`), no server feature; not advertised in plan copy |
| Boost | ⚪ | `triggerBoost` returns false; not advertised |

### Chat
| Feature | Status | Evidence |
|---|---|---|
| Send/receive text, images, voice; RLS; rate limit | ✅ | `10_functional_rls.sql`, `44_voice_messages.sql`, `47_chat_media_paths.sql`, `voiceMessages` |
| Delivered ticks | ✅ | `66_message_delivery.sql`, `messageReceipts` |
| Read receipts (Plus/VIP, all paths) | ✅ | `73_read_receipt_privacy.sql`, `readReceiptPrivacy` |
| Unread badges, mark read | ✅ | `73`, `chatDeletionService` |
| Reactions, replies, delete for me / everyone, media cleanup | ✅ | `67`, `68`, `60`, `chatMediaCleanup` |
| View-once images | ✅ | `messageDeletionClient`, `get_match_messages` |
| Typing / presence | ✅ | `typingState`, `chatPresence` |
| Realtime on device | 🟡 | external (Supabase Realtime must be enabled for `messages`, `message_reactions`, `call_events`) |

### Calls
| Feature | Status | Evidence |
|---|---|---|
| Create/accept/decline/cancel/end, idempotent, one active call | ✅ | `40_video_calls.sql`, `49`, `58`, `75` |
| Daily allowance 30 s / 300 s, IST, join-grant clock | ✅ | `72`, `75` |
| Agora event reconciliation | ✅ code, off by default | `74`, `agoraNcs` |
| Token issuance (server, short-lived, bound to call + user) | ✅ | `issueCallToken`, `42_call_tokens.sql`, `agoraProvider` |
| Coins after free time | ✅ ledger / ⚪ purchase | `43_coin_billing.sql`, `46` concurrency; no purchase path (decision) |
| Incoming-call notifications, ringtone, actions | 🟡 | `callNotifications`, `incomingCallController`; device + FCM external |
| Call history in chat | ✅ | `70_call_connect_clock.sql`, `callEvents` |
| Media on device (Agora) | 🟡 | needs App Certificate enabled + device test |

### Subscriptions and billing
| Feature | Status | Evidence |
|---|---|---|
| Purchase, verify (Play Developer API), account binding, pending, acknowledgement after persist, restore | ✅ code / 🟡 Play | `googlePlayBilling`, `purchaseVerification*`, `36`, `41`, `45` concurrency |
| RTDN (Pub/Sub OIDC), revocation, upgrade/downgrade replacement | ✅ code / 🟡 Play | `41_google_play_verification.sql` |
| Entitlement expiry | ✅ | `get_active_subscription_tier`, `72` expired cases, `73` expired Plus |
| Products configured in Play | ⚪ external | blocker A3/A5 |

### Notifications
| Feature | Status | Evidence |
|---|---|---|
| Push registration (consent + OS permission), privacy of payloads | ✅ code | `pushNotificationPolicy`, `likePushPrivacy`, `56`, `57` |
| Dispatch (pg_net trigger + `dispatch-push`) | 🟡 | needs FCM credentials, `google-services.json`, `PUSH_DISPATCH_SECRET`, Vault secrets (`docs/PUSH_SETUP.md`) |
| In-app notification inbox | ✅ | `notifications`, `notificationLifecycle` |
| Notification preferences | ✅ | `38_push_notifications.sql` |

### Safety, moderation, deletion
| Feature | Status | Evidence |
|---|---|---|
| Block / unblock (hides everywhere: feed, chat, calls, likes, receipts) | ✅ | `10`, `63_feed_block_antijoin.sql`, `73`, `76` |
| Report user (rate-limited) | ✅ submit / 🟡 handling | `check_report_rate_limit`; reviewing reports and suspending accounts is done by admins outside the app (dashboard/admin site, external) |
| Suspension blocks sending/calling/discovery | ✅ | `messages_sender_active`, `29_phase789_lifecycle.sql`, `60` |
| In-app account deletion | ✅ | `53_account_deletion.sql`, `54_deletion_security.sql`, `deleteAccountFunction`, `deletionFlow` |
| Web account-deletion request (Play requirement) | ✅ code / 🟡 website | `request-account-deletion`, `process-deletion-requests`, `requestAccountDeletion`; the public page and its scheduler are external |
| Safety Centre, Support screen | ✅ | `supportScreen` test |

### Legal and privacy
| Feature | Status | Evidence |
|---|---|---|
| Terms / privacy in-app + website links | ✅ links / 🟡 content | `legalWebsiteLinks`, `legalPrivacyScreen`; website content unverified |
| Operator / grievance details | 🔴 placeholders | blocker A2 |
| OpenStreetMap-derived data attribution (ODbL) | ✅ | `app/legal/index.tsx` |
| Logs free of personal data | ✅ | `safeLog`, Edge Function logging |

### Android production configuration
| Item | Status | Evidence |
|---|---|---|
| Package `com.chahat.dating`, AAB production / APK preview profiles | ✅ | `mobile/eas.json`, `npx expo config` |
| Release env guard (Supabase vars, no secret key, Agora App ID when calls on) | ✅ | `releaseEnvGuard` (6) |
| Dependencies aligned with SDK 52 | ✅ (offline check) | `npx expo install --check`: "Dependencies are up to date" (offline map) |
| Target API 36 | 🔴 | blocker A1 |
| Permissions | 🟡 | `READ_EXTERNAL_STORAGE` is unnecessary on Android 13+ (photo picker); remove or justify. Camera/mic/location need Play Data-safety declarations (external) |
| Release signing, versionCode (remote, auto-increment) | 🟡 | EAS credentials external |
| Gradle/EAS build | not run | no Android SDK here |

## D. Client/manual actions (complete list)

1. Target API 36 decision and build (A1); request the Play target-API extension.
2. Fill `operatorDetails.ts` and the website legal pages with confirmed operator, grievance officer and policy data (A2).
3. Decide the 15-day plan and the plan copy (A3, A4).
4. Supabase: apply migrations `20260101005900`, `20260101006000`, `20260101006100` in order (after CI is green);
   set Edge Function secrets (`docs/SECRETS_CHECKLIST.md`); enable Realtime on `messages`, `message_reactions`,
   `call_events`; configure the schedulers for `dispatch-push`, `cleanup-chat-media`, `process-deletion-requests`
   (`docs/DEPLOYMENT_RUNBOOK.md`); Auth settings, redirect URLs, Google provider.
5. Agora: App Certificate enabled; production App ID; optional webhook + `AGORA_NCS_SECRET`.
6. EAS: production environment variables; credentials; FCM; `google-services.json` file variable.
7. Play Console: products, service account, RTDN, license testers, Data safety, content rating, account-deletion
   URL, privacy policy URL, target-API extension.
8. Assign selfie-verification and report reviewers (admin site / dashboard) and a response time.
9. Device test plan (`docs/DEVICE_TEST_PLAN.md` + part 1/2 checklists) and real purchases.

## E. Verification run in this environment

* `npm run lint` — 0 errors. `npm run build` (tsc) — 0 errors.
* `npm test -- --ci` — 110 suites, **1131/1131** passed, exit 0.
* `bash supabase/tests/run.sh` (PostgreSQL 16, all 63 migrations) — **1110** functional checks + **57**
  concurrency checks, 0 failures.
* `npx expo config --type public` (production profile) — OK; package `com.chahat.dating`.
* Not run: Gradle/EAS build, device, Play purchases, GitHub Actions, any dashboard.
