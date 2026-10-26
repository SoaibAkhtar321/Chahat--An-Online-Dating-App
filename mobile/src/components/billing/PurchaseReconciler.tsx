// Credits any Google Play purchase that was paid for but not yet verified by the server.
// Without this, a purchase is only processed while the Premium screen is open: if the app was closed, the
// network dropped during verification, or a pending payment cleared later, the user was charged but stayed
// on the free plan (and Google refunds unacknowledged purchases after 3 days). Everything is verified by the
// server exactly as in the Premium screen; this only triggers the same safe, repeatable restore check.
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { useMilo } from "../../context/MiloContext";
import { BILLING_ENABLED, restorePurchases } from "../../services/subscription";

const MIN_GAP_MS = 60_000;

export function PurchaseReconciler() {
  const { user } = useAuth();
  const { refreshSubscription } = useMilo();
  const lastRun = useRef(0);
  const running = useRef(false);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!BILLING_ENABLED || !userId) return;
    let cancelled = false;

    const run = async () => {
      const now = Date.now();
      if (running.current || now - lastRun.current < MIN_GAP_MS) return;
      running.current = true;
      lastRun.current = now;
      try {
        const result = await restorePurchases();
        if (result.success && !cancelled) await refreshSubscription();
      } catch {
        // Silent on purpose: the next foreground or the Restore button retries.
      } finally {
        running.current = false;
      }
    };

    void run();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void run();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [userId, refreshSubscription]);

  return null;
}
