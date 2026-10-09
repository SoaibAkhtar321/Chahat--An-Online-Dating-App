<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Milo prototype state lives in `src/lib/milo-store.ts` (localStorage demo store via useSyncExternalStore); selectors must return stable references (select primitives or the whole state, derive outside) — new arrays cause infinite render loops.
- Mobile screens wrap content in `Phone` (`auth` prop guards signed-in routes after hydration); admin is a separate desktop route.
- Store data is split: per-account fields (USER_KEYS in milo-store) live inside `accounts[email].data`; device-wide demo/admin fields sit at the top level — so separate demo accounts never share private data.
- Profile photos are processed locally by `src/lib/photo.ts` (canvas resize + WEBP/JPEG compression, full image + thumbnail) and stored as `MePhoto` objects; use `mainPhoto`/`mainThumb` helpers, never raw indexes.
- Premium gating goes only through `can(state, ent)`, which reads the admin-editable `plans` config per tier (free/plus/pro) — one source of truth for every screen and admin control.
- `isHidden()` (blocked/suspended/deleted) is the single exclusion check for discovery, likes, chat and calls.
- Admin cross-account edits go through `accountData`/`updateAccount`, so the signed-in account's live state and stored accounts stay consistent.
- Backend boundaries for the future React Native app are documented in docs/BACKEND_HANDOFF.md; keep it updated when prototype responsibilities change.
- Accounts, profiles, Likes, Matches, chats, blocks and reports live in Lovable Cloud; `src/lib/milo-cloud.ts` loads them into the store and writes through via the store's `sync` hooks — screens stay store-driven, no direct DB calls in routes.
- Matches are created only by the `on_swipe` database trigger; the client mirrors the rule for instant UI but never inserts matches.
- Profile id for real members = auth user id as text; sample profiles keep fixed text ids and bundled photos (`is_demo` rows in the DB).
- Admin actions on real accounts go only through `src/lib/admin.functions.ts`, which re-checks `has_role(admin)` on the server before using the privileged client and writes `admin_audit`.
