// Pure validation and business logic functions for Milo Mobile

export function calculateAge(dobString: string): number {
  if (!dobString) return 0;
  const birthDate = new Date(dobString);
  if (isNaN(birthDate.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return Math.max(0, age);
}

export function validateDob(dobString: string): { valid: boolean; error?: string; age?: number } {
  if (!dobString) return { valid: false, error: "Please enter your date of birth" };
  const d = new Date(dobString);
  if (isNaN(d.getTime())) return { valid: false, error: "Invalid date format" };
  if (d > new Date()) return { valid: false, error: "Date of birth cannot be in the future" };
  const age = calculateAge(dobString);
  if (age < 18) return { valid: false, error: "You must be 18 or older to use Milo", age };
  if (age > 100) return { valid: false, error: "Please verify your date of birth", age };
  return { valid: true, age };
}

export function validatePassword(pw: string): { valid: boolean; error?: string } {
  if (pw.length < 8) return { valid: false, error: "Use at least 8 characters" };
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw))
    return { valid: false, error: "Include at least one letter and one number" };
  if (pw.length > 64) return { valid: false, error: "Use 64 characters or fewer" };
  return { valid: true };
}

export function validateCustomInterest(
  raw: string,
  current: string[],
): { valid: boolean; error?: string; value?: string } {
  const v = raw.trim().replace(/\s+/g, " ");
  if (!v) return { valid: false, error: "Type a hobby first" };
  if (v.length > 24) return { valid: false, error: "Keep it under 24 characters" };
  if (!/^[A-Za-z0-9 &'+-]+$/.test(v)) return { valid: false, error: "Invalid characters" };
  if (current.some((x) => x.toLowerCase() === v.toLowerCase()))
    return { valid: false, error: "Already added" };
  return { valid: true, value: v };
}

export function getIstDateString(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  return new Intl.DateTimeFormat("en-CA", options).format(date);
}

export function calculateCompatibility(myInterests: string[], theirInterests: string[]): number {
  const shared = theirInterests.filter((i) => myInterests.includes(i));
  return Math.min(95, 60 + shared.length * 10);
}
