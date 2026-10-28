# Location selection and distance-ranked discovery (Phase 5)

## One authoritative selection
A member's location is one server-side selection: a **mode** (`manual` or `current`) and one **place** from the
server gazetteer (`city_centroids`, every Indian city/town; see "City search" below).
The app keeps no copy on the device, so it survives navigation and restarts without stale state.

| Mode | How it is chosen | What is stored |
| --- | --- | --- |
| `current` | "Use My Current Location" | the nearest place (resolved by the server), plus coordinates rounded to 0.01 degrees (about 1 km) in `discovery_locations` |
| `manual` | "Search City" (server-side search) | the place only; stored coordinates are deleted |

The picker offers exactly these two options. There are no popular-city chips and no default city.

All changes go through `set_my_location_selection(_mode, _city, _latitude, _longitude, _accuracy_m)`, a single
transaction that validates and writes mode, city and coordinates together. A failed call changes nothing.
Rules enforced in the database:
- `manual`: the city must exist in `city_centroids` and must not carry coordinates;
- `current`: valid coordinates are required. `_city` may be `NULL` (what the app sends) or an unknown name, in which case
  the server picks the nearest place within 150 km of the snapped position (`no_city_nearby` if there is none). A *known*
  city more than 150 km from the coordinates is still refused (`city_mismatch`);
- consent (`location_discovery`), rounding, rate limiting and the movement guard still come from
  `set_my_discovery_location`, which the RPC calls;
- `discovery_location_settings.location_mode` is kept in sync by triggers on `discovery_locations`, so the mode can never
  disagree with whether coordinates exist (this also covers consent withdrawal and the legacy RPCs).

`get_my_location_selection()` returns `{mode, city, state, has_location, stale, share_distance}` and never coordinates.

## City search (`search_cities`, migration `20260101005700_dynamic_city_search.sql`)
- `city_centroids` (the existing table, not a new one) holds the 44 original curated cities, unchanged, plus 4,264 places
  from the gazetteer. Ambiguous names are state-qualified (`Gorakhpur, Uttar Pradesh`, `Gorakhpur, Haryana`); the
  stored `profiles.city` is that full display name. Gazetteer rows within 30 km of a curated city of the same name were
  dropped, so `Kolkata`, `Pune`, etc. keep their original rows.
- `search_cities(_query, _limit default 10, max 20)`: authenticated only; queries under 2 characters return nothing;
  ranking is exact > prefix > word-prefix > substring (4+ characters), curated first, then shorter names. Old names
  (`calcutta`, `bangalore`, ...) come from `city_aliases`. It returns `name` and `state` only, never coordinates, and reads
  no member data. Clients still cannot read `city_centroids` or `city_aliases` directly.
- The app (`locationSelection.searchCities`) debounces typing by 300 ms and ignores out-of-order responses.

### Data source and attribution (required)
Gazetteer rows come from the dr5hn **countries-states-cities-database** (`contributions/cities/IN.json`, commit
`c3c828d3feb7d1f9eb31b18583f91bc618b2953b`, 2026-10-27), licensed under the **Open Database License (ODbL) 1.0**.
ODbL requires attribution wherever the data is used; the in-app Legal screen carries it. If you publish the derived table
itself, it must stay under ODbL. Do not use the `country-state-city` npm package instead: it is GPL-3.0.

### Regenerating the gazetteer
`node scripts/generate-india-gazetteer.js <IN.json> <states.json> supabase/migrations/20260101004300_location_selection_and_city_anchor.sql <out.sql>`
writes the VALUES block. Put it in a NEW forward migration (existing migrations are never edited) and keep
`ON CONFLICT (name_key) DO NOTHING` so curated rows and existing `profiles.city` values are never changed.

## Detecting the current location
`mobile/src/services/gpsFix.ts` (shared by `selectCurrentLocation` and the legacy `enableLocationSharing`):
1. Consent (`location_discovery`) is checked by the caller first; no permission prompt or read happens without it.
2. Permission: requested whenever Android still allows it (the old once-per-install lockout is gone). "Approximate" (coarse)
   grants are accepted and reported as approximate. "Don't ask again" stops prompting; the UI offers "Open app settings".
3. Location services off: Android's "turn on location" dialog is shown; if declined the UI offers "Open location settings".
4. A fresh fix: `High` accuracy (precise grant) or `Balanced` (approximate), 15 s; then one `Balanced` retry, 10 s; then the
   OS last-known position only if it is under **2 minutes** old. Fixes older than 2 minutes, invalid, `(0, 0)` or worse than
   5 km are never used (previously a cached position up to 72 hours old could be saved). Mock-provider fixes are refused.
5. If nothing qualifies the result is `timeout` and the UI offers "Try again".
6. The app sends the raw fix with `_city: null`; the server snaps it to ~1 km and resolves the nearest place. No platform or
   third-party geocoder is used, nothing is stored on the device and nothing is logged.

## Discovery ranking (`get_discovery_feed_page`)
- **Anchor:** fresh (72 h) device coordinates; otherwise the selected city's centre; otherwise none.
- **Candidate position:** their fresh device coordinates (coarsened to about 11 km if they hide distance), otherwise their
  city's centre; members with neither are not shown to an anchored viewer.
- **Ranking:** bucketed distance ascending, then id. The radius filter and the paging cursor use the same bucket, so
  nothing is exposed or skipped. There is no strict same-city filter: a sparse neighbourhood continues into neighbouring
  and farther cities, up to the member's maximum distance (default 150 km, slider up to 500). That ordering is the
  progressive expansion; the old client band loop was unused and was removed.
- **Ceiling:** `app_settings.discovery_max_radius_km` (default 500, range 1 to 1000) is the server maximum.
- **No anchor** (no coordinates and no supported city): members are listed without any distance, in a stable order.
- **Honesty about distance:** `distance_basis` is `device` only when both sides use device positions; otherwise `city`, and
  the app shows "About N km away (city to city)" or "In your area". Distances are always buckets, never exact. A null,
  zero or malformed distance renders no label at all (never "0 km").
- **Manual viewers get city-to-city only (since 005700):** when the viewer has no fresh device location, every candidate's
  position is their city centre, never their device position. With thousands of closely spaced, freely selectable town
  centres (manual selection is not rate limited), the old behaviour would let a member hop between towns and triangulate
  another member's snapped device position from distance labels.
- **Unchanged:** gender preference, age range, blocks, already-swiped exclusion, status, onboarding, demo exclusion,
  hide-distance, photo visibility. Profiles' own coordinates are never returned.
- **Performance:** a latitude bounding box prefilters candidates, and `profiles_city_key_idx` supports the city join.
  `EXPLAIN` has not been run against production-sized data; review it before a large launch.

## Screens
Onboarding and Settings share `LocationPicker`. Settings has a "Your location" row (route `/settings/location`).
Discover's location toggle opens the same screen, and Complete Profile shows the city read-only with a Change link.
Every change saves immediately, so there is no local draft; header back and hardware back both leave the screen.
Existing members whose stored city is not in the gazetteer are asked to choose one; until then they are not placed by city.

## Android package
Verified in `mobile/app.json`: `android.package` and `ios.bundleIdentifier` are `com.chahat.dating`, scheme and slug
`chahat`. `docs/RELEASE_DECISIONS.md` records that the earlier `com.milo.dating` was deliberately replaced. Nothing was
renamed in Phase 5.
