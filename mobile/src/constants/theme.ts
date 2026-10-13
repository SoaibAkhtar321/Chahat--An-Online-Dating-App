// Chahat Mobile Design Tokens & Adaptive Theme System
// Featuring brand terracotta (#C84630) with rich warm plum accents
// Fully supporting System, Light, and Dark appearance modes.

export interface ThemeColors {
  primary: string;
  primaryForeground: string;
  primaryHover: string;
  brandGradient: readonly [string, string];

  background: string;
  surface: string;
  surfaceSecondary: string;
  card: string;
  cardForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;

  foreground: string;
  textPrimary: string;
  textSecondary: string;
  ink: string;
  inkForeground: string;

  accent: string;
  accentForeground: string;
  highlight: string;
  highlightForeground: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  successForeground: string;

  border: string;
  input: string;
  inputBackground: string;
  placeholder: string;
  disabled: string;
  overlay: string;
  tabBarBackground: string;
  messageOutgoing: string;
  messageOutgoingText: string;
  messageIncoming: string;
  messageIncomingText: string;
  photoFade: readonly [string, string, string];
}

export const LightColors: ThemeColors = {
  primary: "#C84630",
  primaryForeground: "#FFFDFB",
  primaryHover: "#B33B26",
  brandGradient: ["#D4533C", "#B53926"] as const,

  background: "#FAF7F5",
  surface: "#FFFDFB",
  surfaceSecondary: "#F3ECE8",
  card: "#FFFDFB",
  cardForeground: "#301F29",
  secondary: "#EDE7E3",
  secondaryForeground: "#301F29",
  muted: "#EFEBE8",
  mutedForeground: "#7A6C74",

  foreground: "#301F29",
  textPrimary: "#301F29",
  textSecondary: "#7A6C74",
  ink: "#23141E",
  inkForeground: "#FFFDFB",

  accent: "#E2A94C",
  accentForeground: "#2E1B0E",
  highlight: "#D9EDF2",
  highlightForeground: "#1B4F5B",
  destructive: "#D6392E",
  destructiveForeground: "#FFFFFF",
  success: "#2E9E67",
  successForeground: "#FFFFFF",

  border: "#E2DCD8",
  input: "#E2DCD8",
  inputBackground: "#FFFDFB",
  placeholder: "#A89C97",
  disabled: "#D6CFCB",
  overlay: "rgba(35, 20, 30, 0.6)",
  tabBarBackground: "#FAF7F5",
  messageOutgoing: "#C84630",
  messageOutgoingText: "#FFFDFB",
  messageIncoming: "#EDE7E3",
  messageIncomingText: "#301F29",
  photoFade: ["transparent", "rgba(35, 20, 30, 0.25)", "rgba(35, 20, 30, 0.92)"] as const,
};

export const DarkColors: ThemeColors = {
  primary: "#E05A42",
  primaryForeground: "#FFFDFB",
  primaryHover: "#C84630",
  brandGradient: ["#E05A42", "#C84630"] as const,

  background: "#161014",
  surface: "#241A21",
  surfaceSecondary: "#2F232B",
  card: "#241A21",
  cardForeground: "#F7F2F5",
  secondary: "#2F232B",
  secondaryForeground: "#F7F2F5",
  muted: "#2C2028",
  mutedForeground: "#A99BA4",

  foreground: "#F7F2F5",
  textPrimary: "#F7F2F5",
  textSecondary: "#A99BA4",
  ink: "#100B0E",
  inkForeground: "#F7F2F5",

  accent: "#F0B65E",
  accentForeground: "#1E120A",
  highlight: "#264853",
  highlightForeground: "#B2E1EC",
  destructive: "#E8564B",
  destructiveForeground: "#FFFFFF",
  success: "#3BB97B",
  successForeground: "#FFFFFF",

  border: "#3B2D37",
  input: "#3B2D37",
  inputBackground: "#241A21",
  placeholder: "#7D6E77",
  disabled: "#4A3B45",
  overlay: "rgba(0, 0, 0, 0.75)",
  tabBarBackground: "#1A1318",
  messageOutgoing: "#E05A42",
  messageOutgoingText: "#FFFDFB",
  messageIncoming: "#2F232B",
  messageIncomingText: "#F7F2F5",
  photoFade: ["transparent", "rgba(16, 11, 14, 0.35)", "rgba(16, 11, 14, 0.95)"] as const,
};

// Default export for backward compatibility
export const Colors = LightColors;

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
