// Holds the credentials of a signup that is waiting for e-mail confirmation. Memory only: never written to storage,
// never put in navigation params or logs, and cleared as soon as the account is confirmed or the person leaves.
let pending: { email: string; password: string } | null = null;

export function setPendingSignup(email: string, password: string): void {
  pending = { email: email.trim().toLowerCase(), password };
}

export function getPendingSignup(): { email: string; password: string } | null {
  return pending;
}

export function clearPendingSignup(): void {
  pending = null;
}
