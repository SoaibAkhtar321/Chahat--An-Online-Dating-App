import { supabase, isSupabaseConfigured } from "./supabase";
import type { Profile, SwipeResponse } from "../types";
import { getSignedUrls } from "./storage";

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
): Promise<Profile[]> {
  if (!isSupabaseConfigured()) {
    return DEMO_PROFILES;
  }
  try {
    // Server RPC only: it applies blocks, city/seeking filters, already-swiped exclusion and never returns dob.
    const { data: rpcData, error: rpcError } = await supabase.rpc("get_discovery_feed", {
      _limit: 30,
    });
    if (rpcError || !Array.isArray(rpcData)) {
      console.warn("Discovery feed failed:", rpcError?.message);
      return [];
    }
    const signed = await getSignedUrls(
      "photos",
      rpcData.flatMap((r: any) => (Array.isArray(r.photos) ? r.photos.map((p: any) => p.path) : [])),
    );
    return rpcData.map((row: any) => formatProfileRow(row, signed));
  } catch (err) {
    console.warn("Discovery failed:", err);
    return [];
  }
}

function formatProfileRow(r: any, signed: Record<string, string>): Profile {
  const photosArray = Array.isArray(r.photos)
    ? r.photos
        .map((p: any) => (p.path ? signed[p.path] || "" : p.src || ""))
        .filter(Boolean)
    : [];

  return {
    id: r.id,
    name: r.name || "Milo Member",
    age: r.age || 25,
    city: r.city || "Mumbai",
    distanceKm: r.distanceKm || 5,
    bio: r.bio || "",
    photos: photosArray.length > 0 ? photosArray : [DEMO_PROFILES[0]!.photos[0]!],
    interests: r.interests || [],
    intent: r.intents?.[0] || "Serious relationship",
    intents: r.intents || [],
    work: r.work,
    education: r.education,
    prompt: r.prompt,
    lifestyle: r.lifestyle,
    languages: r.languages || [],
    lastActiveMin: 0,
    likesYou: !!r.likes_you,
    isDemo: !!r.is_demo,
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
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return false;

    const { error } = await supabase
      .from("swipes")
      .delete()
      .eq("from_id", uid)
      .eq("to_id", toUserId)
      .eq("kind", "pass");

    return !error;
  } catch {
    return false;
  }
}
