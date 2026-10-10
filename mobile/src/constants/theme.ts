// Milo Mobile Design Tokens
// Faithfully matching the terracotta (#C84630) and warm plum (#301F29) visual identity.

export const Colors = {
  // Brand Terracotta Palette
  primary: "#C84630",
  primaryForeground: "#FFFDFB",
  primaryHover: "#B33B26",
  brandGradient: ["#D4533C", "#B53926"] as const,

  // Backgrounds & Surface
  background: "#FAF7F5",
  card: "#FFFDFB",
  cardForeground: "#301F29",
  secondary: "#EDE7E3",
  secondaryForeground: "#301F29",
  muted: "#EFEBE8",
  mutedForeground: "#7A6C74",

  // Foreground & Ink
  foreground: "#301F29",
  ink: "#23141E",
  inkForeground: "#FFFDFB",

  // Accent & Status
  accent: "#E2A94C",
  accentForeground: "#2E1B0E",
  highlight: "#D9EDF2",
  highlightForeground: "#1B4F5B",
  destructive: "#D6392E",
  destructiveForeground: "#FFFFFF",
  success: "#2E9E67",
  successForeground: "#FFFFFF",

  // Borders & Inputs
  border: "#E2DCD8",
  input: "#E2DCD8",
  inputBackground: "#FFFDFB",
  overlay: "rgba(35, 20, 30, 0.6)",
  photoFade: ["transparent", "rgba(35, 20, 30, 0.25)", "rgba(35, 20, 30, 0.92)"] as const,
};

export const Typography = {
  fontDisplay: "serif",
  fontSans: "System",
  sizes: {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 18,
    xl: 20,
    xxl: 24,
    title: 30,
    hero: 40,
  },
  weights: {
    regular: "400" as const,
    medium: "500" as const,
    semibold: "600" as const,
    bold: "700" as const,
  },
};

export const Radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  full: 9999,
};

export const Shadows = {
  card: {
    shadowColor: "#301F29",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  glow: {
    shadowColor: "#C84630",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
};
