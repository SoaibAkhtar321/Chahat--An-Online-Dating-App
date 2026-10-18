// Pure rules for the Terms/Privacy acceptance UI and the version-aware gate (kept free of React for unit tests).
export type LegalGateStatus = "unknown" | "accepted" | "required" | "error";

export const LEGAL_ACCEPT_PATH = "/legal/accept";
export const LEGAL_ACCEPTANCE_REQUIRED_MESSAGE =
  "Please tick the box to agree to the Terms & Conditions and acknowledge the Privacy Policy.";

// Screens that must stay reachable while acceptance is pending (the documents themselves and the acceptance screen).
const GATE_EXEMPT_PATHS = new Set([LEGAL_ACCEPT_PATH, "/legal/terms", "/legal/privacy"]);

/** Returns an error message when the required acceptance box is not ticked, otherwise undefined. */
export function validateLegalAcceptance(accepted: boolean): string | undefined {
  return accepted ? undefined : LEGAL_ACCEPTANCE_REQUIRED_MESSAGE;
}

/** Where a signed-in user must be sent for acceptance, or null if no redirect is needed. */
export function legalGateRedirect(args: {
  isLoggedIn: boolean;
  legalStatus: LegalGateStatus;
  pathname: string;
}): string | null {
  if (!args.isLoggedIn || args.legalStatus !== "required") return null;
  return GATE_EXEMPT_PATHS.has(args.pathname) ? null : LEGAL_ACCEPT_PATH;
}
