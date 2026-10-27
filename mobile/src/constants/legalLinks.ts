// Public pages of the official Chahat legal website. One place for the base URL and the page paths, so screens never
// carry their own copies. Every path below exists as a route in the website project (Chahat-admin-legal, `app/<path>`).
// Do not add a path here until that route exists in the website.
export const LEGAL_WEBSITE_BASE_URL = "https://chahatlegal.netlify.app";

export const LEGAL_WEBSITE_PATHS = {
  privacy: "/privacy-policy",
  terms: "/terms",
  communityGuidelines: "/community-guidelines",
  childSafety: "/child-safety",
  deleteAccount: "/delete-account",
  support: "/support",
} as const;

export type LegalWebsiteLink = keyof typeof LEGAL_WEBSITE_PATHS;

/** Full https URL of an official website page. */
export function legalWebsiteUrl(link: LegalWebsiteLink): string {
  return `${LEGAL_WEBSITE_BASE_URL}${LEGAL_WEBSITE_PATHS[link]}`;
}
