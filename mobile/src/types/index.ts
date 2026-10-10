// Data types for Milo Native Android Application

export type Gender = "man" | "woman" | "";
export type Intent = string;

export interface PhotoItem {
  id: string;
  uri: string;
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
  distanceKm: number;
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
  Drinking: ["Never", "Socially", "Often"],
  Smoking: ["Never", "Socially", "Regularly"],
  Workout: ["Rarely", "Sometimes", "Often"],
  Diet: ["Vegetarian", "Eggetarian", "Non-veg", "Vegan", "Jain"],
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
