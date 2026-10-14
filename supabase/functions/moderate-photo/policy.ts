// Pure decision logic for automatic photo moderation.
// No Deno or network imports here, so it can be unit-tested (see __tests__/photoModerationPolicy.test.ts).

export type Decision =
  | { status: "approved" }
  | { status: "rejected"; reason: string }
  | { status: "pending" }; // could not decide: fail closed, the photo stays hidden

export interface SafeSearchAnnotation {
  adult?: string;
  spoof?: string;
  medical?: string;
  violence?: string;
  racy?: string;
}

// Google's likelihood scale. Missing or "UNKNOWN" counts as 0 (undecided).
const RANK: Record<string, number> = {
  VERY_UNLIKELY: 1,
  UNLIKELY: 2,
  POSSIBLE: 3,
  LIKELY: 4,
  VERY_LIKELY: 5,
};

/** A photo is rejected when a category reaches this level. Product decision: adjust here only. */
export const REJECT_AT = {
  adult: "LIKELY",
  violence: "LIKELY",
  racy: "VERY_LIKELY",
} as const;

export const REJECTION_REASON =
  "This photo doesn't meet our community guidelines. Please choose a different photo.";

const CATEGORIES = ["adult", "violence", "racy"] as const;

const rank = (value?: string): number => (value ? (RANK[value] ?? 0) : 0);

export function decide(annotation: SafeSearchAnnotation | null | undefined): Decision {
  if (!annotation) return { status: "pending" };

  // A clear violation is rejected even if another category is unknown.
  if (CATEGORIES.some((c) => rank(annotation[c]) >= (RANK[REJECT_AT[c]] ?? 99))) {
    return { status: "rejected", reason: REJECTION_REASON };
  }

  // Fail closed: if any checked category is missing or unknown, do not approve.
  if (CATEGORIES.some((c) => rank(annotation[c]) === 0)) return { status: "pending" };

  return { status: "approved" };
}
