// Content controlled from the admin panel without an app update: sponsored cards in Discover, the member's
// account status (suspension) and the "Offers & announcements" notification opt-out.
import { isSupabaseConfigured, supabase } from "./supabase";

export interface DiscoverAd {
  id: string;
  advertiser: string;
  title: string;
  body: string;
  imageUrl: string | null;
  ctaLabel: string;
  ctaUrl: string | null;
}

/** Show a sponsored card after this many profile swipes. */
export const AD_EVERY_SWIPES = 7;

export function parseAds(rows: unknown, publicUrl: (path: string) => string): DiscoverAd[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r: any) => r && typeof r.id === "string" && typeof r.title === "string")
    .map((r: any) => ({
      id: r.id,
      advertiser: String(r.advertiser ?? ""),
      title: r.title,
      body: String(r.body ?? ""),
      imageUrl: typeof r.image_path === "string" && r.image_path ? publicUrl(r.image_path) : null,
      ctaLabel: String(r.cta_label || "Learn more"),
      // Only https links are ever opened.
      ctaUrl: typeof r.cta_url === "string" && /^https:\/\//i.test(r.cta_url) ? r.cta_url : null,
    }));
}

export async function fetchDiscoverAds(): Promise<DiscoverAd[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const { data, error } = await supabase.rpc("get_discover_ads", { _limit: 5 });
    if (error) return [];
    return parseAds(data, (path) => supabase.storage.from("ads").getPublicUrl(path).data.publicUrl);
  } catch {
    return [];
  }
}

export function recordAdEvent(adId: string, kind: "impression" | "click"): void {
  if (!isSupabaseConfigured()) return;
  void Promise.resolve(supabase.rpc("record_ad_event", { _ad_id: adId, _kind: kind })).catch(() => undefined);
}

export async function fetchAccountStatus(): Promise<"active" | "suspended" | "unknown"> {
  if (!isSupabaseConfigured()) return "unknown";
  try {
    const { data, error } = await supabase.rpc("get_my_account_status");
    if (error) return "unknown";
    const s = (data as any)?.status;
    return s === "active" || s === "suspended" ? s : "unknown";
  } catch {
    return "unknown";
  }
}

export async function getUpdatesPreference(userId: string): Promise<boolean> {
  try {
    const { data } = await supabase.from("notification_preferences").select("updates").eq("user_id", userId).maybeSingle();
    return (data as any)?.updates !== false;
  } catch {
    return true;
  }
}

export async function setUpdatesPreference(userId: string, updates: boolean): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, updates, updated_at: new Date().toISOString() });
    return !error;
  } catch {
    return false;
  }
}
