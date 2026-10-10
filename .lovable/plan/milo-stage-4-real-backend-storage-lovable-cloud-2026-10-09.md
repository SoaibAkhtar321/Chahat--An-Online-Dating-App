# Milo Stage 4: real backend storage (Lovable Cloud)

Your request counts as approval to lift the "no backend" rule for accounts, profiles, matches and chats only. Payments, video calls and push notifications stay simulated.

## What users get

- Real sign-up and log-in with email + password, plus Google sign-in. Email confirmation is real.
- The same profile, photos, Likes, Matches and chats on every device.
- New messages appear live without refreshing.
- A Match is created only when both people Like each other, decided on the server, never in the browser.
- Blocks, reports, suspensions and deletions are enforced on the server.

## Stays demo for now (still labelled)

Premium purchases, calls, push/email notifications, verification review, voice intros, Explore extras and the admin panel's other settings. These keep using local storage until a later stage.

## Sample profiles

The 6 sample profiles become seeded demo profiles in the database (marked "demo"), so Discover still has people in it. Their auto-replies in chat stay simulated.

## Steps

1. Turn on Lovable Cloud; enable email sign-in and Google.
2. Create tables with strict access rules (see below).
3. Replace demo sign-up, log-in, verify-email, log-out and delete-account with real ones.
4. Load and save profile, photos (Cloud file storage), Likes/Passes, Matches and messages from the server; keep the existing screens unchanged.
5. Move one-time existing local demo data? No: existing browser demo accounts are not migrated (they were demo only).
6. Test end to end with two accounts in two browsers: sign up, profile, mutual Like, Match, live chat, block, delete.
7. Update the backend handoff note and project docs. Stop for your review.

## Technical details

- Tables: `profiles` (1:1 with user, dob check 18+, gender, intent, languages[], interests[], bio, privacy fields), `profile_photos` (storage path, position), `swipes` (from, to, kind like/pass/priority, unique pair), `matches` (user_a < user_b, unique), `messages` (match_id, sender, body, image_path, read_at), `blocks`, `reports`, `user_roles` (admin role via `has_role`).
- RLS: users read/write only their own profile private fields; discovery reads go through a server function returning only public columns for eligible, opposite-sex, unblocked, non-suspended profiles. Messages readable/insertable only by match members who haven't blocked each other.
- Match creation: a database trigger on `swipes` insert creates the match when the reverse Like exists (atomic, never client-side).
- Storage: private `photos` bucket; signed URLs; path prefixed by user id. Client keeps current canvas compression before upload.
- Realtime subscription on `messages` for the open chat and chat list.
- `milo-store.ts` keeps device/demo state; per-account fields move to server queries (TanStack Query) behind the same hooks where possible so screens change minimally.
- Free Like limit stays an Admin setting, checked server-side on swipe insert.
