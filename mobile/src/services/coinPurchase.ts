// Coin purchase entry point. NOT CONFIGURED in this build: no store product, coin pack or price is
// defined, and this module never contacts a payment service or credits a balance. Coins can only
// be credited by the server after it has verified a store purchase (see docs/BILLING.md).
import { isServiceConfigured } from "../config/appConfig";

export type CoinPurchaseErrorCode = "not_configured";

export class CoinPurchaseError extends Error {
  readonly code: CoinPurchaseErrorCode;
  constructor(code: CoinPurchaseErrorCode = "not_configured") {
    super("Buying coins is not available yet.");
    this.name = "CoinPurchaseError";
    this.code = code;
  }
}

export interface CoinPurchaseAvailability {
  available: boolean;
  reason: CoinPurchaseErrorCode | null;
}

/**
 * Purchasing is available only when the feature flag is on AND a purchase adapter is registered.
 * No adapter exists yet, so this is always unavailable and the UI must not show a buy button.
 */
export const REGISTERED_COIN_PURCHASE_CLIENT = false;

export function getCoinPurchaseAvailability(
  flagOn: boolean = isServiceConfigured("coinTopup"),
  adapterRegistered: boolean = REGISTERED_COIN_PURCHASE_CLIENT,
): CoinPurchaseAvailability {
  return flagOn && adapterRegistered
    ? { available: true, reason: null }
    : { available: false, reason: "not_configured" };
}

/** Always rejects until an approved adapter is added; nothing is simulated. */
export async function purchaseCoins(): Promise<never> {
  throw new CoinPurchaseError("not_configured");
}
