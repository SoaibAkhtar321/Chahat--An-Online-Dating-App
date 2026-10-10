# Milo — Stage 1 Plan (no code yet)

Tagline: "Meet. Match. Connect." This is a phone-sized web prototype for review and handoff. It is not the React Native app. The final Android app gets built separately from this handoff.

## 1. Brand direction

- Palette: deep marigold/saffron primary, rose-terracotta accent, warm ivory background, plum-ink text. Dark theme uses plum-charcoal.
- Type: a display serif with character for headings (e.g. Fraunces) and a clean sans for body text (e.g. Manrope).
- Look: full-bleed photo cards, rounded corners, soft shadows, chip tags, a bottom tab bar with 4 tabs (Discover, Likes, Chats, Profile), and gentle spring motion.

## 2. Screen inventory

**Auth:** Splash · Welcome carousel (3) · Sign up · Verify email (sent) · Resend verification · Link invalid/expired · Login · Forgot password · Reset password · Session expired · Logout confirm

**Onboarding (10 steps, with progress bar, saves your place):** Name · Date of birth (blocks anyone under 18) · Gender · Who you want to meet (man↔woman only) · Intentions (casual / meaningful / long-term / marriage) · City & languages · Education/work (optional) · Bio + prompts · Interests & lifestyle · Photos (add, reorder, set main photo, remove, show upload progress and errors) · Profile preview

**Location:** Why we ask · Permission denied → pick a city by hand · Location unavailable

**Discovery:** Swipe deck · Full profile · Filters (age, distance, intentions, interests) · No more profiles · Loading · Error · Match celebration

**Likes:** Who liked you (blurred and locked for free users) · Matches list

**Chat:** Conversation list · Empty state · 1:1 chat (timestamps, unread count, read receipts, typing, sending/failed/retry) · Actions: block / report / unmatch

**Calls:** Outgoing · Incoming · Connecting · Active video · Active audio (mute, camera on/off, flip camera, end) · 60-second free countdown with a warning at 45s · Paid-rate consent sheet · Declined → call ends · Missed call · Connection failed · Call summary · Call history

**Money:** Wallet/balance (only if prepaid is chosen) · Add balance · Transactions · Billing history · Help/refund request · Premium plans · Purchase pending/success/failed · Expired/cancelled · Restore purchases

**Safety & Settings:** Report (8 categories) · Block · Blocked users · Community guidelines · Safety tips · Photo moderation status · Account suspended · Privacy · Notifications prefs · Discovery & location prefs · Edit profile / photos · Help · Terms · Privacy policy · Delete account (two-step)

**Admin (separate area, desktop layout):** User search · Profile/photo review queue · Reports queue · Suspend/restore · Audit log · Subscriptions · Regional call pricing editor · Basic metrics · Billing issue lookup

**Notifications:** In-app inbox (match, message, like, call, missed call, subscription, safety)

## 3. Main journey

```text
Splash → Welcome → Sign up → Verify email → Login
  → Onboarding (10 steps) → Location → Discover
  → Swipe right → (mutual) Match screen → Chat
  → Start video call → 60s free → Consent sheet
       ├─ Accept → paid call (estimated cost shown) → Summary
       └─ Decline → call ends gracefully
Tabs: Discover | Likes | Chats | Profile(→Settings)
```

## 4. Free vs Premium

| Feature                | Free                        | Premium        |
| ---------------------- | --------------------------- | -------------- |
| Daily likes            | Limited (amount you choose) | Unlimited      |
| See who liked you      | Blurred                     | Yes            |
| Advanced filters       | Basic                       | All            |
| Undo last swipe        | No                          | Yes            |
| Profile boost          | No                          | Monthly        |
| Free first call minute | Yes                         | Yes + extended |
| Chat with matches      | Yes                         | Yes            |

## 5. Data model (Lovable Cloud, planned)

profiles, preferences, photos, swipes (one per pair per direction, unique), matches (created only by the server when both people like each other), conversations, messages, blocks, reports, entitlements, call_sessions, call_pricing (region, rate, currency, tax, increment, caps, effective dates), billing_transactions (idempotency key), notification_prefs, user_roles, admin_audit_log.

Access rules: you can only edit your own rows. Messages and calls are visible only to the two matched people. Blocks and suspensions are filtered out on the server. Admin rights are checked on the server through a separate roles table. Pricing and billing are written only by the server.

## 6. Built vs simulated in this prototype

- **Built and clickable:** every screen above, swiping, the match flow, chat UI, call UI with the 60-second countdown and consent sheet, and the settings and admin screens.
- **Simulated (clearly labeled "Demo"):** sign-in, sample profiles, other people's replies, the video stream, payments, and push notifications.
- **Not built (only in the handoff):** real video provider, Google Play Billing, server-side call metering, real location lookup.

## 7. Key risks and decisions you need to make

1. Whether Google Play allows per-minute call billing outside its own billing system. This needs a policy check before choosing a payment provider.
2. Free minute applies per call, per user, or per matched pair?
3. Prepaid wallet or charge per call?
4. Trusted way to detect billing region (e.g. Play country + server IP), kept separate from the city on someone's profile.
5. Photo moderation: manual queue at first, or an automated check too?
6. Daily like limit for free users.

## 8. Next stages

- **Stage 2:** design system, then Auth → Onboarding → Discover → Match → Chat, all on demo data.
- **Stage 3:** calls and consent, pricing, premium, safety, notifications, settings, admin.
- **Stage 4:** audit, plus handoff documents (React Native handoff, Play release checklist, store listing copy, security spec).

## Technical details

- TanStack Start routes, one file per screen group. The prototype sits in a phone-width frame on desktop.
- Demo data lives in a local in-memory store so the prototype runs without a backend. Lovable Cloud gets connected only if you want real sign-in in Stage 2.
- Shared design tokens in styles.css, written so they map 1:1 to a React Native theme file.
