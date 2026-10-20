// Contact details shown on the Help & Support screen. Supplied by the project owner (Soaib / Spesio Technologies).
// These are support contact details only. They are NOT the legal operator, registered address or grievance officer
// of the Legal & Privacy screen (see operatorDetails.ts), which still need legal confirmation.
export const SUPPORT_CONTACT = {
  email: "milodating2026@gmail.com",
  // Postal address, in the order a letter is addressed. Name of a relative from the source document is left out.
  addressLines: ["Bodhi Chhapra, A.D.O. Tola", "Post Gethihawa, District Kushinagar", "Uttar Pradesh, 274802"],
  emailSubject: "Chahat support request",
} as const;

export function supportMailtoUrl(): string {
  return `mailto:${SUPPORT_CONTACT.email}?subject=${encodeURIComponent(SUPPORT_CONTACT.emailSubject)}`;
}
