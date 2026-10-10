import { supabase } from "./supabase";

// Photos and chat media live in PRIVATE buckets; the app only ever uses short-lived signed URLs.
const TTL_SECONDS = 3600;
const REFRESH_MARGIN_MS = 60_000;
const cache = new Map<string, { url: string; expiresAt: number }>();

const key = (bucket: string, path: string) => `${bucket}/${path}`;

/** Returns a map path -> signed URL. Paths that cannot be signed (no access / missing) are omitted. */
export async function getSignedUrls(
  bucket: "photos" | "chat",
  paths: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const now = Date.now();
  const missing: string[] = [];
  for (const p of new Set(paths.filter(Boolean))) {
    const hit = cache.get(key(bucket, p));
    if (hit && hit.expiresAt - REFRESH_MARGIN_MS > now) out[p] = hit.url;
    else missing.push(p);
  }
  if (missing.length === 0) return out;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(missing, TTL_SECONDS);
    if (error || !data) return out;
    for (const row of data) {
      if (row.path && row.signedUrl && !row.error) {
        cache.set(key(bucket, row.path), { url: row.signedUrl, expiresAt: now + TTL_SECONDS * 1000 });
        out[row.path] = row.signedUrl;
      }
    }
  } catch (err) {
    console.warn("createSignedUrls failed:", err);
  }
  return out;
}

export async function getSignedUrl(bucket: "photos" | "chat", path: string): Promise<string | undefined> {
  return (await getSignedUrls(bucket, [path]))[path];
}
