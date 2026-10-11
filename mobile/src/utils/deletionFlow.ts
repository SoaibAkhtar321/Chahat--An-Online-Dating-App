import type { DeleteAccountResult } from "../services/auth";

export const DELETE_CONFIRMATION_WORD = "DELETE";

export function isDeletionConfirmed(text: string): boolean {
  return text.trim() === DELETE_CONFIRMATION_WORD;
}

export type DeletionOutcome = "ignored" | "unconfirmed" | "success" | "failed";

interface RunDeletionOptions {
  confirmationText: string;
  /** Shared in-flight flag (a ref) so rapid double taps cannot start two requests. */
  inFlight: { current: boolean };
  deleteAccount: () => Promise<DeleteAccountResult>;
  onUnconfirmed?: () => void;
  onStart?: () => void;
  onSettled?: () => void;
  /** Runs only after the server reported success. */
  onSuccess: (result: DeleteAccountResult) => void;
  onFailure: (message: string, result?: DeleteAccountResult) => void;
}

const DEFAULT_FAILURE = "Could not delete account right now.";

export async function runAccountDeletion(opts: RunDeletionOptions): Promise<DeletionOutcome> {
  if (opts.inFlight.current) return "ignored";
  if (!isDeletionConfirmed(opts.confirmationText)) {
    opts.onUnconfirmed?.();
    return "unconfirmed";
  }

  opts.inFlight.current = true;
  opts.onStart?.();
  try {
    const result = await opts.deleteAccount();
    if (result && result.success === true) {
      opts.onSuccess(result);
      return "success";
    }
    opts.onFailure(result?.error || DEFAULT_FAILURE, result);
    return "failed";
  } catch (err: any) {
    opts.onFailure(err?.message || DEFAULT_FAILURE);
    return "failed";
  } finally {
    opts.inFlight.current = false;
    opts.onSettled?.();
  }
}