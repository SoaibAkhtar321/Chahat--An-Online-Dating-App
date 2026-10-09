import type { MeProfile, Profile } from "@/lib/milo-store";

// DEMO: transparent rule-based score (no AI). Every point comes from a visible reason.
export function compatibility(me: MeProfile, p: Profile) {
  const reasons: string[] = [];
  let score = 40;
  const shared = p.interests.filter((i) => me.interests.some((x) => x.toLowerCase() === i.toLowerCase()));
  if (shared.length) { score += Math.min(30, shared.length * 10); reasons.push(`You both like ${shared.slice(0, 3).join(", ")}`); }
  if (me.intents.includes(p.intent)) { score += 15; reasons.push(`Same goal: ${p.intent}`); }
  const life = Object.entries(p.lifestyle).filter(([k, v]) => me.lifestyle[k] === v).map(([k]) => k.toLowerCase());
  if (life.length) { score += Math.min(10, life.length * 4); reasons.push(`Similar ${life.join(", ")} habits`); }
  const langs = p.languages.filter((l) => (me.languages ?? []).includes(l));
  if (langs.length) { score += 5; reasons.push(`You both speak ${langs.slice(0, 3).join(", ")}`); }
  if (p.distanceKm <= 10) { score += 5; reasons.push("Lives nearby"); }
  if (!reasons.length) reasons.push("Add interests and goals to your profile to see why you might click");
  return { score: Math.min(99, score), reasons };
}

export const ICEBREAKERS = [
  { lang: "English", text: "What's a small thing that made your week better?" },
  { lang: "English", text: "Chai or coffee, and where's the best cup you've had?" },
  { lang: "Hindi", text: "आपका पसंदीदा वीकेंड प्लान क्या है?" },
  { lang: "Hindi", text: "बचपन की कौन-सी याद आपको आज भी मुस्कुरा देती है?" },
  { lang: "Hinglish", text: "Sach batao, street food mein tumhara all-time favourite kya hai?" },
  { lang: "Hinglish", text: "Agar kal chhutti mil jaaye, toh kahan ghoomne jaoge?" },
];

export const DATE_TIPS = [
  "Start with something from their profile: a shared interest or their prompt.",
  "Suggest a short first meet in a busy public place, like a café.",
  "Tell a friend where you're going and keep chats on Milo until you're comfortable.",
];

/** Connection Journey: optional, editable suggestions. Nothing is ever sent automatically. */
export function journeySuggestions(me: MeProfile, p: Profile) {
  const shared = p.interests.filter((i) => me.interests.some((x) => x.toLowerCase() === i.toLowerCase()));
  const lang = p.languages.find((l) => (me.languages ?? []).includes(l) && l !== "English");
  const first = [
    p.prompt && `I loved your answer to "${p.prompt.q}". ${p.prompt.a.length > 40 ? "What's the story there?" : "Tell me more!"}`,
    shared[0] && `We both like ${shared[0].toLowerCase()}. What got you into it?`,
    `Hi ${p.name}! What's your favourite spot in ${p.city}?`,
    lang && `I see you speak ${lang} too. Which language do you text in most?`,
  ].filter(Boolean) as string[];
  const starters = [
    "What does a perfect weekend look like for you?",
    "What's something you're looking forward to this month?",
    shared[1] ? `Any recommendations for ${shared[1].toLowerCase()}?` : "What's a small thing that always makes your day better?",
  ];
  const dates = [
    shared.includes("Coffee") || shared.includes("Foodie") ? `Try a well-reviewed café in ${p.city}, in a busy area.` : `Meet for chai or coffee at a busy café in ${p.city}.`,
    shared.includes("Art") || shared.includes("Photography") ? "Visit a gallery or museum during the day." : "Take a daytime walk in a popular park or market.",
    "Keep it short (about an hour), arrange your own travel, and tell a friend your plans.",
  ];
  return { first, starters, dates };
}
