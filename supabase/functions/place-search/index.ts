// Secure proxy for city search + reverse geocoding. No API key is shipped in the app.
// Provider: Photon (OpenStreetMap data). Public demo server has no SLA; set PHOTON_URL to a self-hosted
// instance, or swap fetchPhoton() for Google Places / Mapbox (then keep the key in Edge Function secrets).
// verify_jwt stays ON (default), so only signed-in users can call it. Never log request bodies.
const PHOTON = Deno.env.get("PHOTON_URL") ?? "https://photon.komoot.io";
const INDIA_BBOX = "68.1,6.7,97.4,35.7"; // search window only; results are also filtered to countrycode IN
const UA = "Chahat-place-search/1.0 (contact: set-your-email@example.com)";
const CITY_TYPES = ["city", "town"]; // villages/hamlets are not requested

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fetchPhoton(path: string): Promise<Response> {
  return await fetch(`${PHOTON}${path}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
}

type Feature = { geometry: { coordinates: [number, number] }; properties: Record<string, any> };
const toPlace = (f: Feature) => {
  const p = f.properties;
  const name = p.name ?? p.city ?? p.county ?? p.district;
  if (!name || p.countrycode !== "IN") return null;
  return {
    id: `${p.osm_type ?? "?"}${p.osm_id ?? ""}`,
    name,
    state: p.state ?? null,
    country: p.country ?? "India",
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
  };
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  try {
    if (body.mode === "search") {
      const q = String(body.q ?? "").trim().slice(0, 60);
      if (!q) return json({ places: [] });
      const results = await Promise.all(CITY_TYPES.map(async (t) => {
        const r = await fetchPhoton(
          `/api/?q=${encodeURIComponent(q)}&limit=8&lang=en&bbox=${INDIA_BBOX}&osm_tag=place:${t}`);
        if (r.status === 429) throw new Response(null, { status: 429 });
        if (!r.ok) throw new Response(null, { status: 502 });
        return ((await r.json()).features ?? []) as Feature[];
      }));
      const seen = new Set<string>();
      const places = results.flat().map(toPlace).filter((p): p is NonNullable<typeof p> => {
        if (!p || seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      }).slice(0, 8);
      return json({ places });
    }

    if (body.mode === "reverse") {
      const lat = Number(body.lat), lon = Number(body.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return json({ error: "bad_request" }, 400);
      }
      // Re-round server side so precise coordinates never reach the third party even from a modified client.
      const rl = Math.round(lat * 100) / 100, ro = Math.round(lon * 100) / 100;
      const r = await fetchPhoton(`/reverse?lat=${rl}&lon=${ro}&lang=en&limit=1`);
      if (r.status === 429) return json({ error: "rate_limited" }, 429);
      if (!r.ok) return json({ error: "upstream" }, 502);
      const f = ((await r.json()).features ?? [])[0] as Feature | undefined;
      const p = f?.properties;
      const name = p?.city ?? p?.county ?? p?.district;
      if (!p || p.countrycode !== "IN" || !name) return json({ places: [] });
      return json({ places: [{ id: `${p.osm_type ?? "?"}${p.osm_id ?? ""}`, name, state: p.state ?? null,
        country: p.country ?? "India", lat: rl, lon: ro }] });
    }
    return json({ error: "bad_request" }, 400);
  } catch (e) {
    if (e instanceof Response) return json({ error: e.status === 429 ? "rate_limited" : "upstream" }, e.status);
    return json({ error: "upstream" }, 502);
  }
});
