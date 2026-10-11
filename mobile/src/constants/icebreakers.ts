// Smart Icebreakers in Hindi, English & Hinglish
// Cultural and engaging conversation starters to break the awkward silence.

export interface Icebreaker {
  id: string;
  category: "hinglish" | "hindi" | "english";
  text: string;
  emoji: string;
  tag: string;
}

export const SMART_ICEBREAKERS: Icebreaker[] = [
  // Hinglish
  {
    id: "h1",
    category: "hinglish",
    text: "Chai lover ho ya hardcore coffee person? ☕",
    emoji: "☕",
    tag: "Chai vs Coffee",
  },
  {
    id: "h2",
    category: "hinglish",
    text: "Weekend plans kya hai? Sofa pe chill ya road trip? 🚗",
    emoji: "🚗",
    tag: "Weekend Vibes",
  },
  {
    id: "h3",
    category: "hinglish",
    text: "Ek Hindi movie jise aap 10 baar bhi bina bore huye dekh sakte ho? 🍿",
    emoji: "🍿",
    tag: "Bollywood",
  },
  {
    id: "h4",
    category: "hinglish",
    text: "Late night drives with 90s songs ya quiet rooftop cafe? ✨",
    emoji: "✨",
    tag: "Date Idea",
  },
  {
    id: "h5",
    category: "hinglish",
    text: "Maggi spicy pasand hai ya extra cheese wali? 🍜",
    emoji: "🍜",
    tag: "Comfort Food",
  },
  {
    id: "h6",
    category: "hinglish",
    text: "Ek song jo aapke playlist pe hamesha loop pe rehta hai? 🎧",
    emoji: "🎧",
    tag: "Music Taste",
  },

  // Hindi
  {
    id: "hi1",
    category: "hindi",
    text: "आपकी सबसे यादगार यात्रा कौन-सी थी? 🌄",
    emoji: "🌄",
    tag: "यादगार सफर",
  },
  {
    id: "hi2",
    category: "hindi",
    text: "अगर आपको कोई सुपरपावर मिले तो क्या चुनेंगे? 🦸",
    emoji: "🦸",
    tag: "सुपरपावर",
  },
  {
    id: "hi3",
    category: "hindi",
    text: "आपके शहर की सबसे बेहतरीन चाय की टपरी कौन सी है? ☕",
    emoji: "☕",
    tag: "चाय टपरी",
  },
  {
    id: "hi4",
    category: "hindi",
    text: "बारिश के मौसम में गर्म पकौड़े या लॉन्ग ड्राइव? 🌧️",
    emoji: "🌧️",
    tag: "मानसून",
  },
  {
    id: "hi5",
    category: "hindi",
    text: "बचपन का वो खेल जो आज भी बहुत याद आता है? 🪁",
    emoji: "🪁",
    tag: "बचपन",
  },
  {
    id: "hi6",
    category: "hindi",
    text: "रविवार की दोपहर आपकी कैसी बीतती है? ☀️",
    emoji: "☀️",
    tag: "रविवार",
  },

  // English
  {
    id: "e1",
    category: "english",
    text: "What's the best concert or live gig you've ever attended? 🎶",
    emoji: "🎶",
    tag: "Concerts",
  },
  {
    id: "e2",
    category: "english",
    text: "What's a green flag you always appreciate in someone? 🌿",
    emoji: "🌿",
    tag: "Green Flags",
  },
  {
    id: "e3",
    category: "english",
    text: "Street food crawl or quiet candlelight dinner? 🍽️",
    emoji: "🍽️",
    tag: "Foodie",
  },
  {
    id: "e4",
    category: "english",
    text: "What is your comfort TV show you can rewatch anytime? 📺",
    emoji: "📺",
    tag: "Binge Watch",
  },
  {
    id: "e5",
    category: "english",
    text: "Mountains, beaches, or historic old cities? ✈️",
    emoji: "✈️",
    tag: "Wanderlust",
  },
  {
    id: "e6",
    category: "english",
    text: "What's something you're surprisingly good at? 🎯",
    emoji: "🎯",
    tag: "Secret Talent",
  },
];
