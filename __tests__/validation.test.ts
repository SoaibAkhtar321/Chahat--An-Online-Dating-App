describe("Input and Security Validation Rules", () => {
  const validatePassword = (pw: string): { valid: boolean; error?: string } => {
    if (pw.length < 8) return { valid: false, error: "Use at least 8 characters" };
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw))
      return { valid: false, error: "Include at least one letter and one number" };
    if (pw.length > 64) return { valid: false, error: "Use 64 characters or fewer" };
    return { valid: true };
  };

  const validateCustomInterest = (
    raw: string,
    current: string[],
  ): { valid: boolean; error?: string; value?: string } => {
    const v = raw.trim().replace(/\s+/g, " ");
    if (!v) return { valid: false, error: "Type a hobby first" };
    if (v.length > 24) return { valid: false, error: "Keep it under 24 characters" };
    if (!/^[A-Za-z0-9 &'+-]+$/.test(v)) return { valid: false, error: "Invalid characters" };
    if (current.some((x) => x.toLowerCase() === v.toLowerCase()))
      return { valid: false, error: "Already added" };
    return { valid: true, value: v };
  };

  test("rejects weak passwords under 8 characters", () => {
    expect(validatePassword("pass1").valid).toBe(false);
  });

  test("rejects passwords without numbers", () => {
    expect(validatePassword("onlyletters").valid).toBe(false);
  });

  test("rejects passwords without letters", () => {
    expect(validatePassword("12345678").valid).toBe(false);
  });

  test("approves compliant password", () => {
    expect(validatePassword("MiloDating2026!").valid).toBe(true);
  });

  test("validates custom hobby input", () => {
    expect(validateCustomInterest("Cricket", ["Coffee", "Travel"]).valid).toBe(true);
    expect(validateCustomInterest("Coffee", ["Coffee", "Travel"]).valid).toBe(false);
    expect(validateCustomInterest("Way too long hobby exceeding twenty four chars", []).valid).toBe(
      false,
    );
  });
});
