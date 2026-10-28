// Feature switches read at build time (EXPO_PUBLIC_* values are inlined by Expo; keep the literal access).

/**
 * Selfie verification and the "Verified" badge. OFF for launch (2026-10-29): there is no reviewer yet, so a selfie
 * would sit "in review" forever. When off, every entry point, promise and badge is hidden; the server side
 * (private selfie storage, review_verification, the no-self-approval guard) stays in place.
 * Turn on with EXPO_PUBLIC_FEATURE_VERIFICATION=true once selfies are reviewed (admin page or face matching).
 */
export const VERIFICATION_ENABLED = process.env.EXPO_PUBLIC_FEATURE_VERIFICATION === "true";
