// Data types for Milo Native Android Application

export type Gender = "man" | "woman" | "";
export type Intent = string;

export interface PhotoItem {
  id: string;
  uri: string;
  sourceUri?: string;
  path?: string;
  thumbPath?: string;
  isMain?: boolean;
  status: "pending" | "approved" | "rejected";
}

export interface Profile {
  id: string;
  name: string;
  age: number;
  city: string;
  /** Server-bucketed distance in km; null when unknown, hidden by the other member, or blocked. */
  distanceKm: number | null;
  /** "device" = between rounded device positions; "city" = between city centres (approximate, never exact). */
  distanceBasis?: "device" | "city" | null;
  bio: string;
  photos: string[];
  interests: string[];
  intent: string;
  intents?: string[];
  work?: string;
  education?: string;
  prompt?: { q: string; a: string };
  lifestyle?: Record<string, string>;
  languages?: string[];
  lastActiveMin?: number;
  likesYou?: boolean;
  gender?: Gender;
  isDemo?: boolean;
  isVerified?: boolean;
  verificationStatus?: "none" | "pending" | "approved" | "rejected";
  /** Signed, short-lived playback source for the member's voice intro; absent when they have none. */
  voiceIntro?: { url: string; durationSec: number } | null;
}

export interface MeProfile {
  id: string;
  email: string;
  name: string;
  dob: string;
  gender: Gender;
  seeking: Gender;
  intents: string[];
  city: string;
  work: string;
  education: string;
  bio: string;
  prompt: { q: string; a: string };
  interests: string[];
  lifestyle: Record<string, string>;
  languages: string[];
  photos: PhotoItem[];
  ageMin: number;
  ageMax: number;
  distance: number;
  onboarded: boolean;
  verificationStatus: "none" | "pending" | "approved" | "rejected";
  /** Storage path of the member's own voice intro (private "voice-intros" bucket). */
  voiceIntroPath?: string | null;
  voiceIntroDurationSec?: number | null;
}

export interface Filters {
  ageMin: number;
  ageMax: number;
  distance: number;
  intents: string[];
  interests: string[];
  languages: string[];
}

/** The quoted original shown at the top of a reply. Built by the server (get_match_messages) or from the local list. */
export interface ReplyPreview {
  /** Id of the original message. */
  id: string;
  /** Who wrote the original, from the current user's point of view. null when it is unavailable. */
  from: "me" | "them" | null;
  /** Short text snippet. Empty for photos and voice notes, and always empty when unavailable. */
  text: string;
  kind: "text" | "image" | "voice";
  /** The original is gone, deleted for everyone, or deleted for me: no content is shown. */
  unavailable: boolean;
}

export interface Message {
  id: string;
  matchId: string;
  sender: string;
  from: "me" | "them";
  text: string;
  image?: string;
  audio?: string;
  audioDurationSec?: number;
  messageType?: "text" | "image" | "voice" | "system";
  isViewOnce?: boolean;
  viewedAt?: string | null;
  /** Set when the sender deleted the message for everyone (Phase 3A tombstone). Content is always empty then. */
  deletedAt?: string | null;
  /** Id of the message this one replies to (set when it is a reply, even before the preview is known). */
  replyToId?: string | null;
  /** Quoted preview of the original. Missing while it is still unknown (for example a fresh Realtime insert). */
  replyTo?: ReplyPreview | null;
  at: number;
  /** sent = stored on the server, delivered = reached the recipient's app, read = recipient opened the chat. */
  status: "sent" | "delivered" | "read" | "failed";
}

export interface MatchItem {
  id: string;
  otherUser: Profile;
  createdAt: string;
  lastMessage?: Message;
  unreadCount: number;
}

export interface SwipeResponse {
  success: boolean;
  isMatch: boolean;
  matchId?: string;
  likesRemaining: number;
  error?: string;
}

export const INTERESTS = [
  "Travel",
  "Coffee",
  "Cricket",
  "Bollywood",
  "Books",
  "Yoga",
  "Foodie",
  "Music",
  "Hiking",
  "Photography",
  "Gaming",
  "Dance",
  "Cooking",
  "Art",
];

export const PROMPTS = [
  "My ideal Sunday",
  "Green flag",
  "Two truths and a lie",
  "I'm weirdly good at",
  "Best trip ever",
  "Hot take",
];

export const LIFESTYLE: Record<string, string[]> = {
  Height: ["Under 5'4\"", "5'4\" - 5'7\"", "5'8\" - 5'11\"", "6'0\" - 6'2\"", "Over 6'2\"", "Prefer not to say"],
  Exercise: ["Daily", "Often", "Sometimes", "Rarely", "Never", "Prefer not to say"],
  Drinking: ["Never", "Socially", "Often", "Prefer not to say"],
  Smoking: ["Never", "Socially", "Regularly", "Prefer not to say"],
  Workout: ["Rarely", "Sometimes", "Often"],
  Diet: ["Vegetarian", "Eggetarian", "Non-veg", "Vegan", "Jain", "Prefer not to say"],
};

export const LANGUAGES = [
  "English",
  "Hindi",
  "Bengali",
  "Marathi",
  "Telugu",
  "Tamil",
  "Gujarati",
  "Urdu",
  "Kannada",
  "Malayalam",
  "Odia",
  "Punjabi",
  "Assamese",
  "Konkani",
  "Sindhi",
  "Nepali",
];

/** Largest radius the server accepts (app_settings.discovery_max_radius_km, default 500). */
export const MAX_DISCOVERY_RADIUS_KM = 500;

/** Legacy distance value sent to the feed RPC. The feed is global (own city, then nearest cities outward), so it no longer limits who is shown. */
export const DEFAULT_FILTERS: Filters = {
  ageMin: 18,
  ageMax: 35,
  distance: 150,
  intents: [],
  interests: [],
  languages: [],
};
