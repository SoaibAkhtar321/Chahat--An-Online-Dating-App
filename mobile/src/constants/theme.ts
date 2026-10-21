// Chahat Mobile Design Tokens & Adaptive Theme System
// Featuring refined terracotta (#B8402C) with champagne-gold and warm plum accents
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
  // Eye-comfort light: warm ivory canvas (no pure white glare), softly raised
  // porcelain cards, and plum-charcoal text instead of harsh black.
  primary: "#B8402C",
  primaryForeground: "#FFFFFF",
  primaryHover: "#9E3322",
  brandGradient: ["#C9503A", "#9E3222"] as const,

  background: "#F5F0E9",
  surface: "#FBF8F3",
  surfaceSecondary: "#EEE7DE",
  card: "#FBF8F3",
  cardForeground: "#2A1D26",
  secondary: "#EBE3D9",
  secondaryForeground: "#2A1D26",
  muted: "#EDE6DC",
  mutedForeground: "#6F6068",

  foreground: "#2A1D26",
  textPrimary: "#2A1D26",
  textSecondary: "#6F6068",
  ink: "#1F1419",
  inkForeground: "#FBF8F3",

  accent: "#C79A4B",
  accentForeground: "#2B1C0C",
  highlight: "#DCE9EC",
  highlightForeground: "#1F4A55",
  destructive: "#C73A30",
  destructiveForeground: "#FFFFFF",
  success: "#2B8A5E",
  successForeground: "#FFFFFF",

  border: "#E3DACF",
  input: "#E3DACF",
  inputBackground: "#FBF8F3",
  placeholder: "#A09389",
  disabled: "#D4CAC0",
  overlay: "rgba(31, 20, 25, 0.55)",
  tabBarBackground: "#F5F0E9",
  messageOutgoing: "#B8402C",
  messageOutgoingText: "#FFFFFF",
  messageIncoming: "#EBE3D9",
  messageIncomingText: "#2A1D26",
  photoFade: ["transparent", "rgba(31, 20, 25, 0.25)", "rgba(31, 20, 25, 0.92)"] as const,
};

export const DarkColors: ThemeColors = {
  // Premium dark: deep aubergine-ink with clearly stepped elevation layers,
  // warm off-white text, a luminous coral primary and champagne-gold accent.
  primary: "#D44B35",
  primaryForeground: "#FFFFFF",
  primaryHover: "#C4432E",
  brandGradient: ["#EE6A52", "#C9452F"] as const,

  background: "#0E0A0F",
  surface: "#191219",
  surfaceSecondary: "#241A23",
  card: "#1D151D",
  cardForeground: "#F4EEF1",
  secondary: "#2A1F29",
  secondaryForeground: "#F4EEF1",
  muted: "#241A23",
  mutedForeground: "#B2A3AD",

  foreground: "#F4EEF1",
  textPrimary: "#F4EEF1",
  textSecondary: "#B2A3AD",
  ink: "#0A070B",
  inkForeground: "#F4EEF1",

  accent: "#E3B766",
  accentForeground: "#1E140A",
  highlight: "#1F3D47",
  highlightForeground: "#BDE6F0",
  destructive: "#EC5E52",
  destructiveForeground: "#FFFFFF",
  success: "#41C285",
  successForeground: "#0B1F15",

  border: "#33262F",
  input: "#33262F",
  inputBackground: "#191219",
  placeholder: "#85767F",
  disabled: "#443540",
  overlay: "rgba(0, 0, 0, 0.78)",
  tabBarBackground: "#140E14",
  messageOutgoing: "#CB4A33",
  messageOutgoingText: "#FFFFFF",
  messageIncoming: "#2A1F29",
  messageIncomingText: "#F4EEF1",
  photoFade: ["transparent", "rgba(10, 7, 11, 0.4)", "rgba(10, 7, 11, 0.96)"] as const,
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

// Spacing scale: the only allowed values for padding, margin and gap.
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// Layout constants shared by screens and controls.
export const Layout = {
  screenPadding: 24, // horizontal screen padding (20-24)
  sectionGap: Spacing.xl,
  fieldGap: Spacing.lg,
  minTap: 44, // minimum touch target
  buttonHeight: 52, // md button (50-56)
  inputHeight: 52,
} as const;

export const Radii = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 32,
  full: 9999,
};

export const Shadows = {
  // Soft, warm, plum-tinted elevation: wide blur and low opacity reads as
  // expensive; hard dark drop shadows read as cheap.
  card: {
    shadowColor: "#2A1D26",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  glow: {
    shadowColor: "#B8402C",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 5,
  },
};
