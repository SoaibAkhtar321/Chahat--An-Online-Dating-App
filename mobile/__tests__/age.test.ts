import { calculateAge, validateDob } from "../src/utils/validation";

describe("Age and DOB Validation", () => {
  test("calculates age accurately for a 25-year-old", () => {
    const today = new Date();
    const dob = new Date(today.getFullYear() - 25, today.getMonth(), today.getDate())
      .toISOString()
      .slice(0, 10);
    expect(calculateAge(dob)).toBe(25);
  });

  test("rejects users younger than 18", () => {
    const today = new Date();
    const dob = new Date(today.getFullYear() - 17, today.getMonth(), today.getDate())
      .toISOString()
      .slice(0, 10);
    const res = validateDob(dob);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/18 or older/);
  });

  test("approves users 18 or older", () => {
    const today = new Date();
    const dob = new Date(today.getFullYear() - 19, today.getMonth(), today.getDate())
      .toISOString()
      .slice(0, 10);
    const res = validateDob(dob);
    expect(res.valid).toBe(true);
    expect(res.age).toBe(19);
  });

  test("rejects future dates", () => {
    const today = new Date();
    const dob = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
      .toISOString()
      .slice(0, 10);
    const res = validateDob(dob);
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/future/i);
  });

  test("rejects invalid date strings", () => {
    const res = validateDob("invalid-date");
    expect(res.valid).toBe(false);
  });
});
