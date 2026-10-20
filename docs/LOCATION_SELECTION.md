# Location selection and distance-ranked discovery (Phase 5)

## One authoritative selection
A member's location is one server-side selection: a **mode** (`manual` or `current`) and one **supported city**.
The app keeps no copy on the device, so it survives navigation and restarts without stale state.

| Mode | How it is chosen | What is stored |
| --- | --- | --- |
| `current` | "Use my current location" | the city, plus coordinates rounded to 0.01 degrees (about 1 km) in `discovery_locations` |
| `manual` | search box or a popular-city chip (same code path) | the city only; stored coordinates are deleted |

All changes go through `set_my_location_selection(_mode, _city, _latitude, _longitude, _accuracy_m)`, a single
transaction that validates and writes mode, city and coordinates together. A failed call changes nothing.
Rules enforced in the database:
- the city must exist in `city_centroids` (44 supported cities, mirrored in `mobile/src/constants/cities.ts`; a Jest test
  fails if the two lists differ);
- `manual` must not carry coordinates; `current` must carry valid coordinates;
- in `current` mode the city must be within 150 km of the coordinates (`city_mismatch`);
- consent (`location_discovery`), rounding, rate limiting and the movement guard still come from
  `set_my_discovery_location`, which the RPC calls;
- `discovery_location_settings.location_mode` is kept in sync by triggers on `discovery_locations`, so the mode can never
  disagree with whether coordinates exist (this also covers consent withdrawal and the legacy RPCs).

`get_my_location_selection()` returns `{mode, city, has_location, stale, share_distance}` and never coordinates.

## Detecting the city
`mobile/src/services/locationSelection.ts`: consent, then permission (only when the member taps the button, and never
re-requested once Android reports it can't ask again; the UI then offers "Open settings"), then a fix, then
`Location.reverseGeocodeAsync` on the position rounded to about 1 km (Android platform geocoder, no key, no paid API).
If that fails or names no supported city, the nearest bundled city within 150 km is used. If there is none, nothing is
saved and the member is asked to search; no city and no coordinates are ever invented. There is no default city.

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
  the app shows "About N km away (city to city)" or "In your area". Distances are always buckets, never exact.
- **Unchanged:** gender preference, age range, blocks, already-swiped exclusion, status, onboarding, demo exclusion,
  hide-distance, photo visibility. Profiles' own coordinates are never returned.
- **Performance:** a latitude bounding box prefilters candidates, and `profiles_city_key_idx` supports the city join.
  `EXPLAIN` has not been run against production-sized data; review it before a large launch.

## Screens
Onboarding and Settings share `LocationPicker`. Settings has a "Your location" row (route `/settings/location`).
Discover's location toggle opens the same screen, and Complete Profile shows the city read-only with a Change link.
Every change saves immediately, so there is no local draft; header back and hardware back both leave the screen.
Existing members who typed a free-text city that is not supported are asked to choose one; until then they are not placed
by city.

## Android package
Verified in `mobile/app.json`: `android.package` and `ios.bundleIdentifier` are `com.chahat.dating`, scheme and slug
`chahat`. `docs/RELEASE_DECISIONS.md` records that the earlier `com.milo.dating` was deliberately replaced. Nothing was
renamed in Phase 5.
