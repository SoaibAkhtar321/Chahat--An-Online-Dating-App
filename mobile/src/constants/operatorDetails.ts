// Operator, grievance and contact details shown on the Legal & Privacy screen.
//
// Same facts as the public website (chahat-admin-legal lib/legal.ts, 2026-10-29) so the app and site never disagree.
// Items the operator has not decided yet stay as [bracketed] placeholders and show "Not yet provided" in both.
export const OPERATOR_DETAILS = {
  operatorName: "Chahat Friendship App Operations",
  registeredAddress: "Bodhi Chhapra A.D.O Tola, Gaithihaw Mus. Ghithihaw Aht., PO: Gethihawa, Dist: Kushinagar, Uttar Pradesh, 274802, India",
  supportEmail: "milodating2026@gmail.com",
  grievanceOfficerName: "Grievance Redressal Officer",
  grievanceOfficerEmail: "milodating2026@gmail.com",
  grievanceTimelines: "We acknowledge complaints within 24 hours and resolve them within 15 days.",
  childSafetyContact: "milodating2026@gmail.com",
  privacyRequestResponseTime: "[RESPONSE TIME FOR PRIVACY REQUESTS - to be confirmed with legal review]",
  dataRetentionPeriods: "[RETENTION PERIODS FOR RETAINED RECORDS - to be confirmed with legal review]",
  refundPolicy: "Refunds are handled under Google Play's refund policies and applicable consumer law. This does not limit any rights you have by law.",
  serviceProviderConfirmation: "[FINAL LIST OF SERVICE PROVIDERS AND PROCESSING LOCATIONS - to be confirmed]",
} as const;

export type OperatorDetailKey = keyof typeof OPERATOR_DETAILS;

/** A value is an unconfirmed placeholder when it is wrapped in square brackets. */
export function isOperatorPlaceholder(value: string): boolean {
  const v = value.trim();
  return v.startsWith("[") && v.endsWith("]");
}

/** Keys that still hold placeholders. Useful for a release checklist or guard. */
export function unresolvedOperatorDetails(
  details: Record<string, string> = OPERATOR_DETAILS,
): string[] {
  return Object.keys(details).filter((key) => isOperatorPlaceholder(details[key]));
}
