import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import p1 from "@/assets/p1.jpg";
import p2 from "@/assets/p2.jpg";
import p3 from "@/assets/p3.jpg";
import p4 from "@/assets/p4.jpg";
import p5 from "@/assets/p5.jpg";
import p6 from "@/assets/p6.jpg";
import x1 from "@/assets/extra1.jpg";
import x2 from "@/assets/extra2.jpg";
import me from "@/assets/me.jpg";

// DEMO ONLY: in-memory store persisted to localStorage. In production every piece of
// this lives in backend tables with server-enforced rules (see handoff doc).

export type Profile = {
  id: string;
  name: string;
  age: number;
  city: string;
  distanceKm: number;
  bio: string;
  photos: string[];
  interests: string[];
  intent: string;
  work?: string;
  education?: string;
  prompt?: { q: string; a: string };
  lifestyle: Record<string, string>;
  languages: string[];
  /** Demo 'last active' in minutes; 0 = active now. Only shown when both sides allow online status. */
  lastActiveMin: number;
  likesYou: boolean; // demo profiles: preset; real members: they have Liked you (from the server)
  gender?: "man" | "woman";
  /** Built-in sample profile (not a real person). */
  demo?: boolean;
};
/** A profile photo after local compression. `src` is the full-profile image, `thumb` is for cards/avatars. `path`/`thumbPath` are set once uploaded to Cloud storage. */
export type MePhoto = {
  id: string;
  src: string;
  thumb: string;
  w: number;
  h: number;
  kb: number;
  sig?: string;
  status: "pending" | "approved" | "rejected";
  path?: string;
  thumbPath?: string;
};
export type Message = {
  id: string;
  from: "me" | "them";
  text: string;
  at: number;
  status: "sent" | "read" | "failed";
  /** Local-only compressed image (demo, never uploaded). */ image?: string;
};
export type MeProfile = {
  name: string;
  dob: string;
  gender: "man" | "woman" | "";
  seeking: "man" | "woman" | "";
  intents: string[];
  city: string;
  locMode: "ask" | "granted" | "denied" | "unavailable";
  work: string;
  education: string;
  bio: string;
  prompt: { q: string; a: string };
  interests: string[];
  lifestyle: Record<string, string>;
  languages: string[];
  photos: MePhoto[];
  ageMin: number;
  ageMax: number;
  distance: number;
  /** Voice intro kept only in this browser (data URL). */
  voice: { src: string; sec: number; at: number } | null;
  /** Premium travel mode: discover people in this city instead of nearby. */
  travelCity: string;
};
export type Filters = {
  ageMin: number;
  ageMax: number;
  distance: number;
  intents: string[];
  interests: string[];
  languages: string[];
};
export type Report = {
  id: string;
  targetId: string;
  category: string;
  note: string;
  at: number;
  status: "open" | "actioned" | "dismissed";
  by?: string;
  source?: "profile" | "chat" | "call";
  history?: { at: number; action: string }[];
};
export type Notice = {
  id: string;
  kind: "match" | "message" | "like" | "call" | "subscription" | "safety" | "announcement";
  text: string;
  at: number;
  read: boolean;
  link?: string;
};
export type PriceRow = {
  id: string;
  region: string;
  currency: string;
  ratePerMin: number | null;
  taxPct: number | null;
  incrementSec: number;
  maxMinutes: number | null;
  active: boolean;
};
export type CallRecord = {
  id: string;
  with: string;
  at: number;
  mode: "video" | "audio";
  direction: "out" | "in";
  outcome: "completed" | "missed" | "declined" | "failed";
  freeSec: number;
  paidSec: number;
  currency?: string;
  estCost?: number;
};
export type Purchase = {
  id: string;
  at: number;
  item: string;
  outcome: "demo-activated" | "failed" | "cancelled" | "restored-none";
};
export const ENTS = {
  likesList: "Full incoming-Likes list",
  unlimitedLikes: "Unlimited Likes",
  boost: "Profile Boost",
  superLike: "Priority Likes",
  advancedFilters: "Advanced filters",
  undoPass: "Undo Pass",
  incognito: "Incognito mode",
  travelMode: "Travel mode",
  longerCalls: "Longer video calls",
  adFree: "Ad-free (only if ads are ever enabled)",
  insights: "Profile insights",
} as const;
export type Ent = keyof typeof ENTS;
export type Announcement = { id: string; at: number; text: string; active: boolean };
export type PaidRule = "consent_all" | "premium_continue";
export type FreeRule = "per_call" | "per_user" | "per_pair";
export type Tier = "free" | "plus" | "pro";
export type PlanCfg = {
  name: string;
  features: Ent[];
  price: number | null;
  currency: string;
  period: string;
  visible: boolean;
  approved: boolean;
};
export type Verification = {
  status: "none" | "pending" | "approved" | "rejected";
  selfie?: string;
  at?: number;
  note?: string;
};
export const TIER_NAMES: Record<Tier, string> = {
  free: "Free",
  plus: "Premium Plus",
  pro: "Premium Pro",
};

type Account = { pw: string; verified: boolean; data: UserData | null; createdAt?: number };
type State = {
  _hydrated: boolean;
  /** True once the Cloud session check (and the signed-in account's data load) has finished. */
  sessionReady: boolean;
  /** Real members loaded from Cloud, keyed by profile id. */
  people: Record<string, Profile>;
  /** Profile ids of people who have Liked me (server). */
  likers: string[];
  /** Other person's profile id -> match id on the server. */
  matchIds: Record<string, string>;
  account: { email: string; verified: boolean; id?: string } | null;
  accounts: Record<string, Account>;
  loggedIn: boolean;
  onboardingStep: number;
  onboarded: boolean;
  me: MeProfile;
  filters: Filters;
  swiped: Record<string, "like" | "pass">;
  lastSwipe: string | null;
  likesUsed: number;
  matches: string[];
  messages: Record<string, Message[]>;
  unread: Record<string, number>;
  blocked: string[];
  reports: Report[];
  notices: Notice[];
  premium: {
    active: boolean;
    plan?: string;
    tier?: Exclude<Tier, "free">;
    status: "none" | "pending" | "active" | "cancelled" | "expired";
  };
  superLikesUsed: number;
  superLiked: string[];
  verification: Verification;
  groups: string[];
  quiz: Record<string, string>;
  games: Record<string, Record<number, string>>;
  polls: Record<string, string>;
  boostUntil: number;
  settings: { notif: Record<string, boolean>; privacy: Record<string, boolean> };
  callConfig: {
    freeSeconds: number;
    warnAt: number;
    rule: FreeRule;
    billingRegion: string;
    freeDailyLikes: number;
    boostMinutes: number;
    paidRule: PaidRule;
    superLikesPerDay: number;
  };
  plans: Record<Tier, PlanCfg>;
  packs: {
    id: string;
    name: string;
    qty: number;
    price: number | null;
    currency: string;
    visible: boolean;
  }[];
  intentOptions: string[];
  deleted: string[];
  sentNotices: { id: string; at: number; text: string; to: string }[];
  announcements: Announcement[];
  purchases: Purchase[];
  pricing: PriceRow[];
  freeUsed: string[];
  calls: CallRecord[];
  suspended: string[];
  audit: { id: string; at: number; action: string }[];
};

/** Fields that belong to one signed-in account. Everything else is device-wide demo/admin state. */
const USER_KEYS = [
  "onboardingStep",
  "onboarded",
  "me",
  "filters",
  "swiped",
  "lastSwipe",
  "likesUsed",
  "matches",
  "messages",
  "unread",
  "blocked",
  "notices",
  "premium",
  "boostUntil",
  "settings",
  "freeUsed",
  "calls",
  "purchases",
  "superLikesUsed",
  "superLiked",
  "verification",
  "groups",
  "quiz",
  "games",
  "polls",
] as const;
type UserKey = (typeof USER_KEYS)[number];
export type UserData = Pick<State, UserKey>;

/** Spoken languages (a profile preference — the app interface itself is English-only). */
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
const L = (drink: string, smoke: string, workout: string, diet: string) => ({
  Drinking: drink,
  Smoking: smoke,
  Workout: workout,
  Diet: diet,
});

export const PROFILES: Profile[] = [
  {
    id: "ananya",
    lastActiveMin: 0,
    languages: ["English", "Hindi", "Marathi"],
    name: "Ananya",
    age: 27,
    city: "Mumbai",
    distanceKm: 4,
    photos: [p1, x1],
    likesYou: true,
    bio: "Sea-face sunsets, filter coffee, and long conversations about nothing and everything.",
    interests: ["Coffee", "Travel", "Bollywood", "Yoga", "Pottery"],
    intent: "Serious relationship",
    work: "Product designer",
    education: "NID Ahmedabad",
    lifestyle: L("Socially", "Never", "Sometimes", "Vegetarian"),
    prompt: { q: "My ideal Sunday", a: "Vada pav at Juhu, then a nap I'm not sorry about." },
  },
  {
    id: "meera",
    lastActiveMin: 45,
    languages: ["English", "Kannada", "Tamil"],
    name: "Meera",
    age: 25,
    city: "Bengaluru",
    distanceKm: 12,
    photos: [p2, x1],
    likesYou: false,
    bio: "Bookstore regular. Will judge you (kindly) by your last read.",
    interests: ["Books", "Music", "Hiking", "Cooking"],
    intent: "Long-term relationship",
    work: "Data analyst",
    education: "Christ University",
    lifestyle: L("Never", "Never", "Often", "Eggetarian"),
    prompt: { q: "Green flag", a: "You recommend a book and actually remember why." },
  },
  {
    id: "riya",
    lastActiveMin: 180,
    languages: ["Hindi", "English"],
    name: "Riya",
    age: 29,
    city: "Jaipur",
    distanceKm: 8,
    photos: [p3, x2],
    likesYou: true,
    bio: "Rooftop chai, old havelis and laughing too loud at my own jokes.",
    interests: ["Art", "Coffee", "Photography", "Dance"],
    intent: "Marriage-oriented",
    work: "Architect",
    lifestyle: L("Socially", "Never", "Sometimes", "Non-veg"),
    prompt: {
      q: "Two truths and a lie",
      a: "I've danced at 40 weddings, I hate sweets, I've never missed a sunrise trek.",
    },
  },
  {
    id: "sneha",
    lastActiveMin: 5,
    languages: ["Marathi", "Hindi", "English"],
    name: "Sneha",
    age: 28,
    city: "Pune",
    distanceKm: 18,
    photos: [p5, x2],
    likesYou: true,
    bio: "Monsoon treks in the Sahyadris. Looking for someone who doesn't mind muddy shoes.",
    interests: ["Hiking", "Travel", "Photography", "Foodie", "Birdwatching"],
    intent: "Long-term relationship",
    work: "Civil engineer",
    lifestyle: L("Never", "Never", "Often", "Vegetarian"),
    prompt: { q: "Best trip ever", a: "Kalsubai at sunrise. Worth the 4am alarm." },
  },
  {
    id: "ishita",
    lastActiveMin: 1440,
    languages: ["Bengali", "English", "Hindi"],
    name: "Ishita",
    age: 24,
    city: "Kolkata",
    distanceKm: 35,
    photos: [p6, x1],
    likesYou: false,
    bio: "Rabindra Sangeet, rosogolla debates and pandal-hopping champion.",
    interests: ["Music", "Art", "Books", "Foodie"],
    intent: "Casual dating",
    work: "Content writer",
    lifestyle: L("Socially", "Never", "Rarely", "Non-veg"),
    prompt: { q: "I'm weirdly good at", a: "Guessing the pandal theme from a mile away." },
  },
  {
    id: "kavya",
    lastActiveMin: 0,
    languages: ["Telugu", "Urdu", "English"],
    name: "Kavya",
    age: 26,
    city: "Hyderabad",
    distanceKm: 6,
    photos: [p4, x1],
    likesYou: true,
    bio: "Biryani loyalist. Night walks near Charminar. Ask me for food recs.",
    interests: ["Foodie", "Cricket", "Music", "Travel"],
    intent: "Serious relationship",
    work: "UX researcher",
    lifestyle: L("Socially", "Never", "Sometimes", "Non-veg"),
    prompt: { q: "Hot take", a: "Irani chai > any latte." },
  },
].map((p) => ({ ...p, demo: true, gender: "woman" as const }));

const now = Date.now();
const initial: State = {
  _hydrated: false,
  sessionReady: false,
  people: {},
  likers: [],
  matchIds: {},
  account: null,
  accounts: {},
  loggedIn: false,
  onboardingStep: 0,
  onboarded: false,
  me: {
    name: "",
    dob: "",
    gender: "",
    seeking: "",
    intents: [],
    city: "",
    locMode: "ask",
    work: "",
    education: "",
    bio: "",
    prompt: { q: "My ideal Sunday", a: "" },
    interests: [],
    lifestyle: {},
    languages: [],
    voice: null,
    travelCity: "",
    photos: [{ id: "seed", src: me, thumb: me, w: 768, h: 1024, kb: 0, status: "approved" }],
    ageMin: 22,
    ageMax: 32,
    distance: 25,
  },
  filters: { ageMin: 21, ageMax: 35, distance: 50, intents: [], interests: [], languages: [] },
  swiped: { kavya: "like" },
  lastSwipe: null,
  likesUsed: 0,
  matches: ["kavya"],
  messages: {
    kavya: [
      {
        id: "k1",
        from: "them",
        text: "Hey! Your Delhi photo made me miss chole bhature 😄",
        at: now - 3600e3 * 5,
        status: "read",
      },
      {
        id: "k2",
        from: "me",
        text: "Haha, ok you've got good taste. Hyderabad biryani or Lucknowi?",
        at: now - 3600e3 * 4.8,
        status: "read",
      },
      {
        id: "k3",
        from: "them",
        text: "Hyderabadi, always. That's not even a question.",
        at: now - 3600e3 * 1,
        status: "read",
      },
      {
        id: "k4",
        from: "them",
        text: "Free for a quick call later?",
        at: now - 3600e3 * 0.9,
        status: "read",
      },
    ],
  },
  unread: { kavya: 2 },
  blocked: [],
  reports: [
    {
      id: "r-seed",
      targetId: "demo-user-417",
      category: "Scam or fraud",
      note: "Asked for money on day one.",
      at: now - 864e5,
      status: "open",
    },
  ],
  notices: [
    {
      id: "n1",
      kind: "message",
      text: "Kavya sent you a message",
      at: now - 3600e3,
      read: false,
      link: "/chat/kavya",
    },
    {
      id: "n2",
      kind: "like",
      text: "Someone new liked you",
      at: now - 7200e3,
      read: false,
      link: "/likes",
    },
    {
      id: "n3",
      kind: "safety",
      text: "Tip: keep chats on Milo until you're comfortable",
      at: now - 864e5,
      read: true,
    },
  ],
  premium: { active: false, status: "none" },
  boostUntil: 0,
  superLikesUsed: 0,
  superLiked: [],
  verification: { status: "none" },
  groups: [],
  quiz: {},
  games: {},
  polls: {},
  settings: {
    notif: {
      Matches: true,
      Messages: true,
      Likes: true,
      Calls: true,
      Subscription: true,
      "Safety & account": true,
    },
    privacy: {
      "Show me in Discover": true,
      "Show my distance": true,
      "Show my age": true,
      "Show online status": true,
      "Read receipts": true,
      "Incognito (Premium)": false,
    },
  },
  // Product-owner decisions: left configurable. Rates intentionally unset — set them in Admin.
  callConfig: {
    freeSeconds: 60,
    warnAt: 45,
    rule: "per_call",
    billingRegion: "IN",
    freeDailyLikes: 10,
    boostMinutes: 30,
    paidRule: "consent_all",
    superLikesPerDay: 3,
  },
  // Plan contents, prices and periods are placeholders pending client approval (approved: false until signed off).
  plans: {
    free: {
      name: "Free",
      features: [],
      price: 0,
      currency: "INR",
      period: "—",
      visible: true,
      approved: true,
    },
    plus: {
      name: "Premium Plus",
      features: [
        "likesList",
        "unlimitedLikes",
        "boost",
        "advancedFilters",
        "undoPass",
        "longerCalls",
      ],
      price: null,
      currency: "INR",
      period: "1 month",
      visible: true,
      approved: false,
    },
    pro: {
      name: "Premium Pro",
      features: [
        "likesList",
        "unlimitedLikes",
        "boost",
        "superLike",
        "advancedFilters",
        "undoPass",
        "incognito",
        "travelMode",
        "longerCalls",
        "insights",
      ],
      price: null,
      currency: "INR",
      period: "1 month",
      visible: true,
      approved: false,
    },
  },
  packs: [
    { id: "boost1", name: "1 Boost", qty: 1, price: null, currency: "INR", visible: false },
    {
      id: "super5",
      name: "5 Priority Likes",
      qty: 5,
      price: null,
      currency: "INR",
      visible: false,
    },
  ],
  intentOptions: [
    "Casual dating",
    "Serious relationship",
    "Long-term relationship",
    "Marriage-oriented",
    "Friendship",
    "Not sure yet",
  ],
  deleted: [],
  sentNotices: [],
  announcements: [],
  pricing: [
    {
      id: "IN",
      region: "India",
      currency: "INR",
      ratePerMin: null,
      taxPct: null,
      incrementSec: 60,
      maxMinutes: null,
      active: true,
    },
    {
      id: "AE",
      region: "United Arab Emirates",
      currency: "AED",
      ratePerMin: null,
      taxPct: null,
      incrementSec: 60,
      maxMinutes: null,
      active: false,
    },
    {
      id: "US",
      region: "United States",
      currency: "USD",
      ratePerMin: null,
      taxPct: null,
      incrementSec: 60,
      maxMinutes: null,
      active: false,
    },
  ],
  freeUsed: [],
  calls: [],
  purchases: [],
  suspended: [],
  audit: [],
};

const KEY = "milo-demo-v3";
let state: State = initial;
const listeners = new Set<() => void>();

const pickUser = (st: State): UserData =>
  Object.fromEntries(USER_KEYS.map((k) => [k, st[k]])) as UserData;
const freshUser = (): UserData => pickUser(initial);
/** A brand-new real account: no sample matches, chats or notices. */
export const emptyUser = (): UserData => ({
  ...freshUser(),
  swiped: {},
  matches: [],
  messages: {},
  unread: {},
  notices: [],
  me: { ...initial.me, photos: [] },
});
/** Fills fields added after an account was saved (e.g. spoken languages) without touching anything else. */
export const migrate = (d: Partial<UserData> | null | undefined): Partial<UserData> =>
  d
    ? {
        ...d,
        ...(d.me
          ? {
              me: {
                ...initial.me,
                ...d.me,
                languages: [...new Set(d.me.languages ?? [])],
                intents: [
                  ...new Set(
                    (d.me.intents ?? []).map((i) =>
                      i === "Meaningful relationship" ? "Serious relationship" : i,
                    ),
                  ),
                ],
              },
            }
          : {}),
        ...(d.settings
          ? {
              settings: {
                notif: { ...initial.settings.notif, ...d.settings.notif },
                privacy: { ...initial.settings.privacy, ...d.settings.privacy },
              },
            }
          : {}),
        ...(d.verification ? {} : { verification: { status: "none" as const } }),
        ...(d.filters ? { filters: { ...initial.filters, ...d.filters } } : {}),
      }
    : {};
/** Accounts map with the signed-in account's latest data written back into it. */
function syncedAccounts(st: State) {
  const email = st.account?.email;
  if (!email || !st.loggedIn || !st.accounts[email]) return st.accounts;
  return { ...st.accounts, [email]: { ...st.accounts[email]!, data: pickUser(st) } };
}
/** Session/Cloud fields are never written to this browser's storage. */
const SESSION_KEYS = [
  "_hydrated",
  "sessionReady",
  "people",
  "likers",
  "matchIds",
  "account",
  "loggedIn",
] as const;
let warnedQuota = false;
function emit() {
  if (typeof window !== "undefined") {
    // Only device-wide demo/admin fields are stored locally; account data lives in Lovable Cloud.
    const out: Record<string, unknown> = { ...state, accounts: syncedAccounts(state) };
    for (const k of [...USER_KEYS, ...SESSION_KEYS]) delete out[k];
    try {
      localStorage.setItem(KEY, JSON.stringify(out));
      warnedQuota = false;
    } catch {
      if (!warnedQuota) {
        warnedQuota = true;
        toast.error("This browser's demo storage is full. Reset the demo in Admin.");
      }
    }
  }
  listeners.forEach((l) => l());
}
export function hydrateStore() {
  if (state._hydrated || typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<State>;
      for (const k of [...USER_KEYS, ...SESSION_KEYS]) delete (saved as Record<string, unknown>)[k];
      state = {
        ...initial,
        ...saved,
        plans: { ...initial.plans, ...(saved.plans ?? {}) },
        callConfig: { ...initial.callConfig, ...(saved.callConfig ?? {}) },
      };
    }
  } catch {
    /* ignore */
  }
  state = { ...state, ...emptyUser(), loggedIn: false, account: null, _hydrated: true };
  listeners.forEach((l) => l());
}
export function setState(fn: (s: State) => Partial<State>) {
  state = { ...state, ...fn(state) };
  emit();
}
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function useMilo<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => sel(state),
    () => sel(initial),
  );
}

/** Cloud write-through hooks, registered by milo-cloud.ts once a member is signed in. */
export const sync: {
  active?: boolean;
  swipe?: (id: string, kind: "like" | "pass" | "priority", match: boolean) => void;
  unswipe?: (id: string) => void;
  send?: (otherId: string, msg: Message) => void;
  markRead?: (otherId: string) => void;
  unmatch?: (otherId: string) => void;
  block?: (otherId: string) => void;
  unblock?: (otherId: string) => void;
  report?: (targetId: string, category: string, note: string, source: string) => void;
} = {};

// ---- Demo accounts (NOT real authentication: passwords are only obfuscated and stored in this browser) ----
const normEmail = (e: string) => e.trim().toLowerCase();
function demoHash(email: string, pw: string) {
  let h = 5381;
  const str = `${normEmail(email)}:${pw}`;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `d${(h >>> 0).toString(36)}`;
}
export function signUp(emailRaw: string, pw: string): "ok" | "exists" {
  const email = normEmail(emailRaw);
  if (state.accounts[email]) return "exists";
  const accounts = syncedAccounts(state);
  state = {
    ...state,
    ...freshUser(),
    accounts: {
      ...accounts,
      [email]: { pw: demoHash(email, pw), verified: false, data: null, createdAt: Date.now() },
    },
    account: { email, verified: false },
    loggedIn: false,
  };
  emit();
  return "ok";
}
export function confirmEmail() {
  const email = state.account?.email;
  if (!email || !state.accounts[email]) return false;
  const acc = state.accounts[email]!;
  state = {
    ...state,
    ...freshUser(),
    ...migrate(acc.data),
    accounts: { ...state.accounts, [email]: { ...acc, verified: true } },
    account: { email, verified: true },
    loggedIn: true,
  };
  emit();
  return true;
}
export function logIn(emailRaw: string, pw: string): "ok" | "invalid" | "unverified" {
  const email = normEmail(emailRaw);
  const acc = state.accounts[email];
  if (!acc || acc.pw !== demoHash(email, pw)) return "invalid";
  const accounts = syncedAccounts(state);
  if (!acc.verified) {
    state = {
      ...state,
      ...freshUser(),
      accounts,
      account: { email, verified: false },
      loggedIn: false,
    };
    emit();
    return "unverified";
  }
  state = {
    ...state,
    ...freshUser(),
    ...migrate(acc.data),
    accounts,
    account: { email, verified: true },
    loggedIn: true,
  };
  emit();
  return "ok";
}
/** Ends the session; the account's data is kept for the next login. */
export function logOut() {
  state = {
    ...state,
    accounts: syncedAccounts(state),
    ...freshUser(),
    account: null,
    loggedIn: false,
  };
  emit();
}
export function deleteAccount() {
  const email = state.account?.email;
  const accounts = { ...state.accounts };
  if (email) delete accounts[email];
  state = { ...state, accounts, ...freshUser(), account: null, loggedIn: false };
  emit();
}
export const isPremium = (s: State) => s.premium.active && s.premium.status === "active";
/** Single entitlement check: Premium is active AND the admin-configured plan includes this feature. */
/** The user's current tier (Free unless a demo Premium activation is active). */
export const tierOf = (s: State): Tier => (isPremium(s) ? (s.premium.tier ?? "plus") : "free");
/** Single entitlement check used by every screen: does the user's tier (as configured in Admin → Plans) include this feature? */
export const can = (s: State, e: Ent) => !!s.plans[tierOf(s)]?.features.includes(e);
/** Hidden from everyone: suspended or deleted by admin, or blocked by me. */
export const isHidden = (s: State, id: string) =>
  s.blocked.includes(id) || s.suspended.includes(id) || s.deleted.includes(id);
export const mainPhoto = (m: MeProfile) => m.photos[0]?.src ?? me;
export const mainThumb = (m: MeProfile) => m.photos[0]?.thumb ?? me;
export function setPhotoStatus(id: string, status: MePhoto["status"]) {
  setState((s) => ({
    me: { ...s.me, photos: s.me.photos.map((p) => (p.id === id ? { ...p, status } : p)) },
  }));
}
export const getState = () => state;
export const resetDemo = () => {
  state = { ...initial, _hydrated: true };
  emit();
};
/** Clears only the signed-in account's demo activity (keeps the account and profile). */
export const resetMyActivity = () =>
  setState((s) => ({
    ...freshUser(),
    me: s.me,
    onboarded: s.onboarded,
    onboardingStep: s.onboardingStep,
    settings: s.settings,
    premium: s.premium,
  }));
/** Placeholder shown while a member's profile is still loading (or after they left). */
const ghost = (id: string): Profile => ({
  id,
  name: "Milo member",
  age: 0,
  city: "",
  distanceKm: 0,
  bio: "",
  photos: [me],
  interests: [],
  intent: "",
  lifestyle: {},
  languages: [],
  lastActiveMin: 99999,
  likesYou: false,
});
export const profileById = (id: string): Profile => {
  const p = PROFILES.find((x) => x.id === id) ?? state.people[id];
  return p ? { ...p, likesYou: p.likesYou || state.likers.includes(id) } : ghost(id);
};
export const uid = () => Math.random().toString(36).slice(2, 10);

export function ageFrom(dob: string) {
  if (!dob) return 0;
  const d = new Date(dob),
    n = new Date();
  if (Number.isNaN(d.getTime())) return 0;
  let a = n.getFullYear() - d.getFullYear();
  if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}

const PREF: Record<Notice["kind"], string | null> = {
  match: "Matches",
  message: "Messages",
  like: "Likes",
  call: "Calls",
  subscription: "Subscription",
  safety: "Safety & account",
  announcement: null,
};
/** Adds an in-app notice for a real event. Respects notification preferences and skips exact duplicates within 60s. */
export function notify(kind: Notice["kind"], text: string, link?: string) {
  const pref = PREF[kind];
  if (pref && state.settings.notif[pref] === false) return false;
  if (state.notices.some((n) => n.text === text && Date.now() - n.at < 60e3)) return false;
  setState((s) => ({
    notices: [
      { id: uid(), kind, text, at: Date.now(), read: false, ...(link ? { link } : {}) },
      ...s.notices,
    ],
  }));
  return true;
}
/** Reads or updates any demo account's private data (the live state if it's the signed-in account). Admin demo use only. */
export function accountData(email: string): Partial<UserData> | null {
  if (state.loggedIn && state.account?.email === email) return pickUser(state);
  return state.accounts[email]?.data ?? null;
}
export function updateAccount(email: string, fn: (d: UserData) => Partial<UserData>) {
  if (state.loggedIn && state.account?.email === email) {
    setState((s) => fn(pickUser(s)));
    return;
  }
  const acc = state.accounts[email];
  if (!acc) return;
  const base = { ...freshUser(), ...migrate(acc.data) } as UserData;
  setState((s) => ({
    accounts: { ...s.accounts, [email]: { ...acc, data: { ...base, ...fn(base) } } },
  }));
}
export function adminDeleteAccount(email: string) {
  if (state.loggedIn && state.account?.email === email) {
    deleteAccount();
    return;
  }
  setState((s) => {
    const a = { ...s.accounts };
    delete a[email];
    return { accounts: a };
  });
}
export function audit(action: string) {
  setState((s) => ({ audit: [{ id: uid(), at: Date.now(), action }, ...s.audit] }));
}

/** Sample profiles plus real members loaded from Cloud. */
export const allPeople = (s: State): Profile[] => [
  ...PROFILES,
  ...Object.values(s.people).map((p) => ({ ...p, likesYou: s.likers.includes(p.id) })),
];
/** Profiles eligible for discovery: not self, not swiped, not blocked/suspended, opposite sex, within filters. */
export function eligibleDeck(s: State) {
  const f = s.filters;
  return (
    allPeople(s)
      .filter(
        (p) =>
          !s.swiped[p.id] &&
          !isHidden(s, p.id) &&
          p.id !== s.account?.id &&
          (!s.me.seeking || !p.gender || p.gender === s.me.seeking) &&
          p.age >= f.ageMin &&
          p.age <= f.ageMax &&
          (travel(s) ? true : p.distanceKm <= f.distance) &&
          (!f.intents.length || f.intents.includes(p.intent)) &&
          (!f.interests.length ||
            p.interests.some((i) =>
              f.interests.some((x) => x.toLowerCase() === i.toLowerCase()),
            )) &&
          // Spoken-language filter applies only when the user explicitly picks languages.
          (!f.languages.length || p.languages.some((l) => f.languages.includes(l))),
      )
      // Travel mode shows the chosen city's people first.
      .sort((a, b) =>
        travel(s) ? Number(b.city === s.me.travelCity) - Number(a.city === s.me.travelCity) : 0,
      )
  );
}
export const travel = (s: State) => can(s, "travelMode") && !!s.me.travelCity;

export type SwipeResult = "match" | "ok" | "limit" | "dup";
export function swipe(id: string, dir: "like" | "pass", priority = false): SwipeResult {
  const p = profileById(id);
  if (!p || state.swiped[id] || isHidden(state, id)) return "dup";
  if (
    dir === "like" &&
    !can(state, "unlimitedLikes") &&
    state.likesUsed >= state.callConfig.freeDailyLikes
  )
    return "limit";
  // Mirrors the server rule (the server creates the actual match): they already Liked me.
  const isMatch = dir === "like" && (p.likesYou || state.likers.includes(id));
  setState((s) => ({
    swiped: { ...s.swiped, [id]: dir },
    lastSwipe: id,
    likesUsed: dir === "like" ? s.likesUsed + 1 : s.likesUsed,
    matches: isMatch && !s.matches.includes(id) ? [...s.matches, id] : s.matches,
  }));
  sync.swipe?.(id, dir === "pass" ? "pass" : priority ? "priority" : "like", isMatch);
  if (isMatch) notify("match", `You matched with ${p.name}`, `/chat/${id}`);
  return isMatch ? "match" : "ok";
}
/** Priority Like (demo entitlement): a Like that is highlighted for the other person. Counts against the daily Priority Like allowance. */
export function superLike(id: string): SwipeResult | "locked" | "none-left" {
  if (!can(state, "superLike")) return "locked";
  if (state.superLikesUsed >= state.callConfig.superLikesPerDay) return "none-left";
  const r = swipe(id, "like", true);
  if (r === "match" || r === "ok")
    setState((s) => ({
      superLikesUsed: s.superLikesUsed + 1,
      superLiked: [...new Set([...s.superLiked, id])],
    }));
  return r;
}
/** Undo Pass only: Likes can't be taken back (they may already have formed a match). */
export function undoSwipe() {
  const id = state.lastSwipe;
  if (!id || state.swiped[id] !== "pass") return null;
  setState((s) => {
    const sw = { ...s.swiped };
    const was = sw[id];
    delete sw[id];
    return {
      swiped: sw,
      lastSwipe: null,
      matches: s.matches.filter((m) => m !== id),
      likesUsed: was === "like" ? Math.max(0, s.likesUsed - 1) : s.likesUsed,
    };
  });
  sync.unswipe?.(id);
  return id;
}

const REPLIES = [
  "Haha, that's sweet 😄",
  "Tell me more!",
  "Okay you have good taste.",
  "Weekend plans?",
  "Ha! Same here.",
];
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : uid();
/** Only matched, unblocked, unsuspended people can message. Returns false if not allowed. */
export const canMessage = (id: string) => state.matches.includes(id) && !isHidden(state, id);
export function sendMessage(id: string, text: string, failSim = false, image?: string) {
  if (!canMessage(id) || (!text.trim() && !image)) return false;
  const msg: Message = {
    id: newId(),
    from: "me",
    text,
    at: Date.now(),
    status: failSim ? "failed" : "sent",
    ...(image ? { image } : {}),
  };
  setState((s) => ({ messages: { ...s.messages, [id]: [...(s.messages[id] ?? []), msg] } }));
  if (failSim) return true;
  if (sync.send) {
    sync.send(id, msg);
    return true;
  }
  setTimeout(() => {
    if (!canMessage(id)) return;
    setState((s) => {
      const list = (s.messages[id] ?? []).map((m) =>
        m.from === "me" && m.status === "sent" ? { ...m, status: "read" as const } : m,
      );
      const reply: Message = {
        id: uid(),
        from: "them",
        text: REPLIES[list.length % REPLIES.length] ?? "😊",
        at: Date.now(),
        status: "read",
      };
      return {
        messages: { ...s.messages, [id]: [...list, reply] },
        unread: { ...s.unread, [id]: (s.unread[id] ?? 0) + 1 },
      };
    });
  }, 1800);
  return true;
}
/** Opening a chat clears its unread count (and tells the server, if read receipts are on). */
export function markRead(id: string) {
  if (state.unread[id]) setState((s) => ({ unread: { ...s.unread, [id]: 0 } }));
  sync.markRead?.(id);
}
export function retryMessage(id: string, mid: string) {
  const m = state.messages[id]?.find((x) => x.id === mid);
  if (!m) return;
  setState((s) => ({
    messages: { ...s.messages, [id]: (s.messages[id] ?? []).filter((x) => x.id !== mid) },
  }));
  sendMessage(id, m.text, false, m.image);
}
function dropConversation(id: string) {
  setState((s) => {
    const m = { ...s.messages };
    delete m[id];
    const u = { ...s.unread };
    delete u[id];
    return { matches: s.matches.filter((x) => x !== id), messages: m, unread: u };
  });
}
export const unmatch = (id: string) => {
  sync.unmatch?.(id);
  dropConversation(id);
};
export function block(id: string) {
  sync.block?.(id);
  dropConversation(id);
  setState((s) => ({ blocked: [...new Set([...s.blocked, id])] }));
}
export const unblock = (id: string) => {
  sync.unblock?.(id);
  setState((s) => ({ blocked: s.blocked.filter((b) => b !== id) }));
};
export function report(
  targetId: string,
  category: string,
  note: string,
  source: Report["source"] = "profile",
) {
  const at = Date.now();
  sync.report?.(targetId, category, note.trim().slice(0, 500), source ?? "profile");
  setState((s) => ({
    reports: [
      {
        id: uid(),
        targetId,
        category,
        note: note.trim().slice(0, 500),
        at,
        status: "open",
        ...(s.account ? { by: s.account.email } : {}),
        source,
        history: [{ at, action: "Submitted" }],
      },
      ...s.reports,
    ],
  }));
}

/** Free-minute eligibility, per the configurable product rule. */
export function freeSecondsFor(withId: string) {
  const { rule, freeSeconds } = state.callConfig;
  if (rule === "per_call") return freeSeconds;
  const key = rule === "per_user" ? "me" : `pair:${withId}`;
  return state.freeUsed.includes(key) ? 0 : freeSeconds;
}
export function markFreeUsed(withId: string) {
  const { rule } = state.callConfig;
  if (rule === "per_call") return;
  const key = rule === "per_user" ? "me" : `pair:${withId}`;
  setState((s) => ({ freeUsed: [...new Set([...s.freeUsed, key])] }));
}
export const activeRate = () =>
  state.pricing.find(
    (p) => p.id === state.callConfig.billingRegion && p.active && p.ratePerMin != null,
  ) ?? null;

export const totalUnread = (s: State) =>
  Object.values(s.unread).reduce((a, b) => a + b, 0) +
  s.matches.filter((m) => !s.messages[m]?.length).length;

/** Online/last-seen text, shown only when I share my own status (reciprocal) and the other side hasn't hidden theirs. */
export function lastSeen(s: State, p: Profile): string | null {
  if (s.settings.privacy["Show online status"] === false) return null;
  const m = p.lastActiveMin;
  return m <= 2
    ? "Active now"
    : m < 60
      ? `Active ${m} min ago`
      : m < 1440
        ? `Active ${Math.round(m / 60)} h ago`
        : "Active in the last few days";
}
