// Subscription & Pricing Service for CHAHAT / Milo Android
// Supports Free, Premium (₹99), Plus (₹199), and VIP (₹399) tiers with multi-month packages.

import AsyncStorage from "@react-native-async-storage/async-storage";

export type PlanTier = "free" | "premium" | "plus" | "vip";

export interface PlanFeature {
  title: string;
  hindiTitle: string;
  includedIn: PlanTier[];
}

export interface PlanConfig {
  id: PlanTier;
  name: string;
  hindiName: string;
  tagline: string;
  monthlyPrice: number;
  badge?: string;
  popular?: boolean;
  features: string[];
}

export interface BillingDuration {
  id: "1m" | "3m" | "6m" | "12m";
  months: number;
  label: string;
  totalPrice: number;
  savings?: string;
  popular?: boolean;
}

export const BILLING_DURATIONS: BillingDuration[] = [
  {
    id: "1m",
    months: 1,
    label: "1 महीना (1 Month)",
    totalPrice: 99,
  },
  {
    id: "3m",
    months: 3,
    label: "3 महीने (3 Months)",
    totalPrice: 249,
    savings: "Save ₹48 (16% Off)",
  },
  {
    id: "6m",
    months: 6,
    label: "6 महीने (6 Months)",
    totalPrice: 449,
    savings: "Save ₹145 (24% Off)",
  },
  {
    id: "12m",
    months: 12,
    label: "12 महीने (1 Year)",
    totalPrice: 799,
    savings: "Save ₹389 (33% Off)",
    popular: true,
  },
];

export const PLANS: Record<PlanTier, PlanConfig> = {
  free: {
    id: "free",
    name: "Free Plan",
    hindiName: "मुफ़्त प्लान",
    tagline: "मूल सुविधाएं हमेशा मुफ़्त (Always Free)",
    monthlyPrice: 0,
    features: [
      "Profile बनाना (Create Profile)",
      "रोज़ 20 Likes (20 Daily Likes)",
      "Limited Matching & Discover Deck",
      "Basic Chat — Match होने के बाद",
      "Free Selfie/Profile Verification Badge",
      "Safety Centre & Block/Report",
    ],
  },
  premium: {
    id: "premium",
    name: "CHAHAT Premium",
    hindiName: "चाहत प्रीमियम",
    tagline: "प्यार और दोस्ती की शुरुआत",
    monthlyPrice: 99,
    popular: true,
    badge: "Most Popular",
    features: [
      "Unlimited Likes (असीमित लाइक्स)",
      "किसने Like किया देखें (See Who Liked You)",
      "Undo Last Swipe (Rewind Pass)",
      "ज्यादा Profile Recommendations",
      "Smart Icebreakers (Hindi, English, Hinglish)",
      "Compatibility Score Breakdown",
    ],
  },
  plus: {
    id: "plus",
    name: "CHAHAT Plus",
    hindiName: "चाहत प्लस",
    tagline: "अधिक विजिबिलिटी और तेज़ी से मैच",
    monthlyPrice: 199,
    features: [
      "Premium के सभी Features",
      "महीने में 5 Profile Boosts",
      "Advanced Search Filters (City, Lifestyle)",
      "Priority Profile Visibility (शीर्ष प्राथमिकता)",
      "Voice Intro & Audio Highlights",
      "Read Receipts Control",
    ],
  },
  vip: {
    id: "vip",
    name: "CHAHAT VIP",
    hindiName: "चाहत वीआईपी",
    tagline: "सर्वश्रेष्ठ अनुभव और विशेष प्राइवेसी",
    monthlyPrice: 399,
    badge: "Exclusive VIP",
    features: [
      "Plus के सभी Features",
      "15 Profile Boosts प्रति माह",
      "Extra Discovery & Travel Mode",
      "Incognito Mode (पूर्ण गोपनीयता)",
      "Exclusive VIP Profile Customization",
      "Priority Customer Support 24/7",
    ],
  },
};

const STORAGE_KEY_USER_SUBSCRIPTION = "chahat_user_subscription";

export interface UserSubscription {
  tier: PlanTier;
  duration: "1m" | "3m" | "6m" | "12m";
  activatedAt: number;
  expiresAt: number;
  autoRenew: boolean;
  orderId?: string;
}

export async function getUserSubscription(): Promise<UserSubscription> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_USER_SUBSCRIPTION);
    if (raw) {
      const sub = JSON.parse(raw) as UserSubscription;
      // Check if expired
      if (sub.tier !== "free" && Date.now() > sub.expiresAt) {
        return {
          tier: "free",
          duration: "1m",
          activatedAt: Date.now(),
          expiresAt: Infinity,
          autoRenew: false,
        };
      }
      return sub;
    }
  } catch (err) {
    console.warn("Could not read subscription from storage:", err);
  }

  return {
    tier: "free",
    duration: "1m",
    activatedAt: Date.now(),
    expiresAt: Infinity,
    autoRenew: false,
  };
}

export async function activateSubscription(
  tier: PlanTier,
  durationId: "1m" | "3m" | "6m" | "12m" = "1m",
): Promise<UserSubscription> {
  const duration = BILLING_DURATIONS.find((d) => d.id === durationId) || BILLING_DURATIONS[0]!;
  const days = duration.months * 30;
  const activatedAt = Date.now();
  const expiresAt = activatedAt + days * 24 * 60 * 60 * 1000;

  const newSub: UserSubscription = {
    tier,
    duration: durationId,
    activatedAt,
    expiresAt,
    autoRenew: true,
    orderId: `CHAHAT_ORD_${Date.now()}`,
  };

  await AsyncStorage.setItem(STORAGE_KEY_USER_SUBSCRIPTION, JSON.stringify(newSub));
  return newSub;
}

export async function cancelSubscription(): Promise<UserSubscription> {
  const freeSub: UserSubscription = {
    tier: "free",
    duration: "1m",
    activatedAt: Date.now(),
    expiresAt: Infinity,
    autoRenew: false,
  };
  await AsyncStorage.setItem(STORAGE_KEY_USER_SUBSCRIPTION, JSON.stringify(freeSub));
  return freeSub;
}

export function hasEntitlement(
  tier: PlanTier,
  feature:
    | "unlimitedLikes"
    | "seeWhoLikedYou"
    | "undoPass"
    | "profileBoost"
    | "advancedFilters"
    | "priorityVisibility"
    | "incognito"
    | "voiceIntro",
): boolean {
  if (tier === "vip") return true;
  if (tier === "plus") {
    return feature !== "incognito";
  }
  if (tier === "premium") {
    return (
      feature === "unlimitedLikes" ||
      feature === "seeWhoLikedYou" ||
      feature === "undoPass" ||
      feature === "voiceIntro"
    );
  }
  // Free tier
  return false;
}
