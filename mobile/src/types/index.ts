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
}

export interface Filters {
  ageMin: number;
  ageMax: number;
  distance: number;
  intents: string[];
  interests: string[];
  languages: string[];
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
  at: number;
  status: "sent" | "read" | "failed";
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

export const CITIES = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Hyderabad",
  "Chennai",
  "Kolkata",
  "Pune",
  "Jaipur",
  "Ahmedabad",
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

export const DEFAULT_FILTERS: Filters = {
  ageMin: 18,
  ageMax: 35,
  distance: 50,
  intents: [],
  interests: [],
  languages: [],
};
