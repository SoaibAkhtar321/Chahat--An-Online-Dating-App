import { supabase, isSupabaseConfigured } from "./supabase";
import type { Profile, SwipeResponse } from "../types";
import { getSignedUrls } from "./storage";
import { pushNotificationToInbox } from "./notifications";

// Bundled demo profiles for offline/testing mode matching prototype exactly
export const DEMO_PROFILES: Profile[] = [
  {
    id: "ananya",
    name: "Ananya",
    age: 27,
    city: "Mumbai",
    distanceKm: 4,
    photos: [
      "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&auto=format&fit=crop&q=80",
      "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&auto=format&fit=crop&q=80",
    ],
    bio: "Sea-face sunsets, filter coffee, and long conversations about nothing and everything.",
    interests: ["Coffee", "Travel", "Bollywood", "Yoga", "Pottery"],
    intent: "Serious relationship",
    work: "Product designer",
    education: "NID Ahmedabad",
    prompt: { q: "My ideal Sunday", a: "Vada pav at Juhu, then a nap I'm not sorry about." },
    lifestyle: { Drinking: "Socially", Smoking: "Never", Workout: "Sometimes", Diet: "Vegetarian" },
    languages: ["English", "Hindi", "Marathi"],
    lastActiveMin: 0,
    likesYou: true,
    isDemo: true,
    isVerified: true,
    verificationStatus: "approved",
  },
  {
    id: "meera",
    name: "Meera",
    age: 25,
    city: "Bengaluru",
    distanceKm: 12,
    photos: [
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&auto=format&fit=crop&q=80",
    ],
    bio: "Bookstore regular. Will judge you (kindly) by your last read.",
    interests: ["Books", "Music", "Hiking", "Cooking"],
    intent: "Long-term relationship",
    work: "Data analyst",
    education: "Christ University",
    prompt: { q: "Green flag", a: "You recommend a book and actually remember why." },
    lifestyle: { Drinking: "Never", Smoking: "Never", Workout: "Often", Diet: "Eggetarian" },
    languages: ["English", "Kannada", "Tamil"],
    lastActiveMin: 45,
    likesYou: false,
    isDemo: true,
  },
  {
    id: "riya",
    name: "Riya",
    age: 29,
    city: "Jaipur",
    distanceKm: 8,
    photos: [
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&auto=format&fit=crop&q=80",
    ],
    bio: "Rooftop chai, old havelis and laughing too loud at my own jokes.",
    interests: ["Art", "Coffee", "Photography", "Dance"],
    intent: "Marriage-oriented",
    work: "Architect",
    lifestyle: { Drinking: "Socially", Smoking: "Never", Workout: "Sometimes", Diet: "Non-veg" },
    prompt: {
      q: "Two truths and a lie",
      a: "I've danced at 40 weddings, I hate sweets, I've never missed a sunrise trek.",
    },
    languages: ["Hindi", "English"],
    lastActiveMin: 180,
    likesYou: true,
    isDemo: true,
  },
  {
    id: "sneha",
    name: "Sneha",
    age: 28,
    city: "Pune",
    distanceKm: 18,
    photos: [
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&auto=format&fit=crop&q=80",
    ],
    bio: "Monsoon treks in the Sahyadris. Looking for someone who doesn't mind muddy shoes.",
    interests: ["Hiking", "Yoga", "Music", "Books"],
    intent: "Serious relationship",
    work: "Physiotherapist",
    lifestyle: { Drinking: "Never", Smoking: "Never", Workout: "Often", Diet: "Vegetarian" },
    prompt: { q: "Hot take", a: "Mountains over beaches any day of the year." },
    languages: ["Marathi", "Hindi", "English"],
    lastActiveMin: 5,
    likesYou: true,
    isDemo: true,
  },
];

export async function fetchDiscoveryDeck(
  currentUserId: string,
  userCity: string,
  seekingGender: string,
  filters?: import("../types").Filters,
): Promise<Profile[]> {
  void currentUserId;
  void userCity;
  void seekingGender;
  const result = await fetchDiscoveryPage(filters);
  return result.profiles;
}

export interface DiscoveryCursor {
  distanceMeters: number;
  profileId: string;
}

export interface DiscoveryPage {
  profiles: Profile[];
  nextCursor: DiscoveryCursor | null;
}

export async function fetchDiscoveryPage(
  filters?: import("../types").Filters,
  cursor?: DiscoveryCursor | null,
): Promise<DiscoveryPage> {
  if (!isSupabaseConfigured()) {
    return { profiles: filterDemoProfiles(filters), nextCursor: null };
  }

  try {
    const safeFilters = filters ?? {
      ageMin: 18,
      ageMax: 99,
      distance: 50,
      intents: [],
      interests: [],
      languages: [],
    };
    const { data, error } = await supabase.rpc("get_discovery_feed_page", {
      _limit: 30,
      _age_min: safeFilters.ageMin,
      _age_max: safeFilters.ageMax,
      _radius_km: safeFilters.distance,
      _intents: safeFilters.intents,
      _interests: safeFilters.interests,
      _languages: safeFilters.languages,
      _after_distance_m: cursor?.distanceMeters ?? null,
      _after_id: cursor?.profileId ?? null,
    });
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error("Discovery returned an invalid response.");

    const signed = await getSignedUrls(
      "photos",
      data.flatMap((row: any) =>
        Array.isArray(row.photos) ? row.photos.map((photo: any) => photo.path).filter(Boolean) : [],
      ),
    );
    const profiles = data.map((row: any) => formatProfileRow(row, signed));
    const last = data[data.length - 1];
    return {
      profiles,
      nextCursor:
        data.length === 30 && last
          ? { distanceMeters: last.cursor_distance_m, profileId: last.id }
          : null,
    };
  } catch (error) {
    console.warn("Discovery page failed:", error);
    return { profiles: [], nextCursor: null };
  }
}

function filterDemoProfiles(filters?: import("../types").Filters): Profile[] {
  let deck = [...DEMO_PROFILES];
  if (filters && deck.length > 0) {
    deck = deck.filter((profile) => {
      if (filters.ageMin && profile.age < filters.ageMin) return false;
      if (filters.ageMax && profile.age > filters.ageMax) return false;
      if (filters.distance && profile.distanceKm > filters.distance) return false;
      if (filters.interests && filters.interests.length > 0) {
        const hasMatchingInterest = profile.interests.some((i) =>
          filters.interests.some((fi) => fi.toLowerCase() === i.toLowerCase()),
        );
        if (!hasMatchingInterest) return false;
      }
      if (filters.languages && filters.languages.length > 0 && profile.languages) {
        const hasMatchingLanguage = profile.languages.some((l) =>
          filters.languages.some((fl) => fl.toLowerCase() === l.toLowerCase()),
        );
        if (!hasMatchingLanguage) return false;
      }
      return true;
    });
  }
  return deck;
}

function formatProfileRow(r: any, signed: Record<string, string>): Profile {
  const photosArray = Array.isArray(r.photos)
    ? r.photos
        .map((p: any) => (p.path ? signed[p.path] || "" : ""))
        .filter(Boolean)
    : [];

  return {
    id: r.id,
    name: r.name || "Chahat Member",
    age: r.age || 25,
    city: r.city || "",
    distanceKm: r.distance_km ?? r.distanceKm ?? 0,
    bio: r.bio || "",
    photos: photosArray,
    interests: r.interests || [],
    intent: r.intents?.[0] || "Serious relationship",
    intents: r.intents || [],
    work: r.work,
    education: r.education,
    prompt: r.prompt,
    lifestyle: r.lifestyle,
    languages: r.languages || [],
    lastActiveMin: 0,
    likesYou: false,
    isDemo: false,
    isVerified: r.is_verified === true || r.verification_status === "approved",
    verificationStatus: r.verification_status || (r.is_verified ? "approved" : "none"),
  };
}

export async function submitSwipe(
  toUserId: string,
  kind: "like" | "pass" | "priority",
): Promise<SwipeResponse> {
  try {
    const { data, error } = await supabase.rpc("record_swipe", {
      _to_id: toUserId,
      _kind: kind,
    });

    if (error) {
      return {
        success: false,
        isMatch: false,
        likesRemaining: 0,
        error: error.message || "Could not record swipe. Please try again.",
      };
    }

    if (data.is_match) {
      pushNotificationToInbox({
        kind: "match",
        title: "New Match!",
        text: "You and a new connection liked each other. Start a conversation!",
        data: {
          matchId: data.match_id,
          profileId: toUserId,
        },
      }).catch(() => {});
    }

    return {
      success: data.success,
      isMatch: data.is_match,
      matchId: data.match_id,
      likesRemaining: data.likes_remaining ?? 0,
      error: data.error,
    };
  } catch (err: any) {
    return {
      success: false,
      isMatch: false,
      likesRemaining: 0,
      error: err.message,
    };
  }
}

export async function undoLastPass(toUserId: string): Promise<boolean> {
  try {
    if (!isSupabaseConfigured()) {
      return true; // Local preview mock
    }
    const { data, error } = await supabase.rpc("undo_swipe_pass", {
      _target_id: toUserId,
    });
    if (error) {
      console.warn("undoLastPass error:", error.message);
      return false;
    }
    return Boolean(data?.success);
  } catch {
    return false;
  }
}
