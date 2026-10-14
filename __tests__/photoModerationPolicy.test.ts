import { decide, REJECT_AT } from "../supabase/functions/moderate-photo/policy";

const clean = { adult: "VERY_UNLIKELY", violence: "VERY_UNLIKELY", racy: "UNLIKELY", spoof: "UNLIKELY", medical: "UNLIKELY" };

describe("photo moderation policy", () => {
  it("approves a clean photo", () => {
    expect(decide(clean).status).toBe("approved");
  });

  it("rejects adult content at LIKELY or above", () => {
    expect(decide({ ...clean, adult: "POSSIBLE" }).status).toBe("approved");
    expect(decide({ ...clean, adult: "LIKELY" }).status).toBe("rejected");
    expect(decide({ ...clean, adult: "VERY_LIKELY" }).status).toBe("rejected");
  });

  it("rejects violence at LIKELY or above", () => {
    expect(decide({ ...clean, violence: "LIKELY" }).status).toBe("rejected");
  });

  it("rejects racy content only at VERY_LIKELY", () => {
    expect(decide({ ...clean, racy: "LIKELY" }).status).toBe("approved");
    expect(decide({ ...clean, racy: "VERY_LIKELY" }).status).toBe("rejected");
  });

  it("ignores spoof and medical", () => {
    expect(decide({ ...clean, spoof: "VERY_LIKELY", medical: "VERY_LIKELY" }).status).toBe("approved");
  });

  it("fails closed: missing or unknown data is never approved", () => {
    expect(decide(null).status).toBe("pending");
    expect(decide(undefined).status).toBe("pending");
    expect(decide({}).status).toBe("pending");
    expect(decide({ ...clean, adult: "UNKNOWN" }).status).toBe("pending");
    expect(decide({ adult: "VERY_UNLIKELY", violence: "VERY_UNLIKELY" }).status).toBe("pending");
  });

  it("still rejects a clear violation when another category is unknown", () => {
    expect(decide({ adult: "VERY_LIKELY", violence: "UNKNOWN", racy: "UNKNOWN" }).status).toBe("rejected");
  });

  it("keeps the documented thresholds", () => {
    expect(REJECT_AT).toEqual({ adult: "LIKELY", violence: "LIKELY", racy: "VERY_LIKELY" });
  });
});
