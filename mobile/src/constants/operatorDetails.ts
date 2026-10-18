// Operator, grievance and contact details shown on the Legal & Privacy screen.
//
// NOTHING here has been confirmed. Every value in square brackets is a clearly marked placeholder that the app shows as
// "Not yet provided". Replace a placeholder with the real value (no brackets) once the operator and legal reviewer have
// confirmed it. Do not invent details: a wrong grievance officer or address is worse than a visible gap.
export const OPERATOR_DETAILS = {
  operatorName: "[OPERATOR LEGAL NAME - to be confirmed]",
  registeredAddress: "[REGISTERED ADDRESS - to be confirmed]",
  supportEmail: "[SUPPORT EMAIL - to be confirmed]",
  grievanceOfficerName: "[GRIEVANCE OFFICER NAME - to be confirmed]",
  grievanceOfficerEmail: "[GRIEVANCE OFFICER EMAIL - to be confirmed]",
  grievanceTimelines: "[ACKNOWLEDGEMENT AND RESOLUTION TIMELINES - to be confirmed with legal review]",
  childSafetyContact: "[CHILD SAFETY CONTACT NAME AND EMAIL - to be confirmed]",
  childSafetyStandardsUrl: "[PUBLIC WEB PAGE FOR CHILD SAFETY STANDARDS - to be confirmed]",
  privacyRequestResponseTime: "[RESPONSE TIME FOR PRIVACY REQUESTS - to be confirmed with legal review]",
  dataRetentionPeriods: "[RETENTION PERIODS FOR RETAINED RECORDS - to be confirmed with legal review]",
  refundPolicy: "[REFUND POLICY - to be confirmed]",
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
