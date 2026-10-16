// Server-side coin purchase adapter. Store SDKs, credentials and receipt verification live ONLY
// behind this interface, inside Edge Functions.
//
// No real adapter ships in this build and NO coin pack, price or product id is defined here:
// those are business decisions that need explicit approval. `resolveCoinPurchaseAdapter` therefore
// returns the explicit "not configured" adapter unless a registered adapter is selected AND has its
// credentials. Nothing is ever credited without a verified order. See docs/BILLING.md.

export type CoinPurchaseFailureCode = "not_configured" | "invalid_purchase" | "provider_error";

export type CoinPurchaseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: CoinPurchaseFailureCode; message: string };

export interface VerifyCoinPurchaseInput {
  /** The authenticated user id from the verified JWT, never from the request body. */
  userId: string;
  productId: string;
  purchaseToken: string;
}

/** What a store-verified purchase is worth. `coins` comes from the server-side catalogue only. */
export interface VerifiedCoinPurchase {
  /** The store's unique order identifier. It becomes the ledger idempotency key. */
  orderRef: string;
  coins: number;
}

export interface CoinPurchaseAdapter {
  readonly name: string;
  readonly configured: boolean;
  verifyPurchase(input: VerifyCoinPurchaseInput): Promise<CoinPurchaseResult<VerifiedCoinPurchase>>;
}

export class NotConfiguredCoinPurchaseAdapter implements CoinPurchaseAdapter {
  readonly name = "none";
  readonly configured = false;

  constructor(private readonly reason: string = "No coin purchase adapter is configured.") {}

  async verifyPurchase(): Promise<CoinPurchaseResult<VerifiedCoinPurchase>> {
    return { ok: false, code: "not_configured", message: this.reason };
  }
}

export type CoinPurchaseEnv = Record<string, string | undefined>;

/** A factory returns an adapter, or null when its own credentials are missing. */
export type CoinPurchaseAdapterFactory = (env: CoinPurchaseEnv) => CoinPurchaseAdapter | null;

export const REGISTERED_COIN_PURCHASE_ADAPTERS: Readonly<Record<string, CoinPurchaseAdapterFactory>> = {};

export function resolveCoinPurchaseAdapter(
  env: CoinPurchaseEnv,
  registry: Readonly<Record<string, CoinPurchaseAdapterFactory>> = REGISTERED_COIN_PURCHASE_ADAPTERS,
): CoinPurchaseAdapter {
  const selected = (env.COIN_PURCHASE_ADAPTER ?? "").trim().toLowerCase();
  if (!selected) return new NotConfiguredCoinPurchaseAdapter("COIN_PURCHASE_ADAPTER is not set.");
  if (!Object.prototype.hasOwnProperty.call(registry, selected)) {
    return new NotConfiguredCoinPurchaseAdapter("The selected coin purchase adapter has no implementation in this build.");
  }
  let adapter: CoinPurchaseAdapter | null = null;
  try {
    adapter = registry[selected](env);
  } catch {
    return new NotConfiguredCoinPurchaseAdapter("The selected coin purchase adapter failed to initialise.");
  }
  if (!adapter || !adapter.configured) {
    return new NotConfiguredCoinPurchaseAdapter("The selected coin purchase adapter is missing credentials.");
  }
  return adapter;
}

// Mirrors the database: order references and credit sizes are validated again by
// public.credit_coins_from_purchase, so a bug here cannot create an unbounded or duplicate credit.
export const ORDER_REF_PATTERN = /^[A-Za-z0-9._:=-]{8,160}$/;
export const MAX_COINS_PER_PURCHASE = 100_000_000;

export interface CreditDeps {
  /** Calls public.credit_coins_from_purchase with the service role. Resolves to its raw JSON. */
  credit(userId: string, coins: number, orderRef: string): Promise<unknown>;
}

export type CreditResult =
  | { ok: true; applied: boolean; balance: number }
  | { ok: false; code: CoinPurchaseFailureCode | "credit_failed"; message: string };

/**
 * Verifies a purchase with the adapter and, only if the adapter vouches for it, credits the wallet
 * exactly once (the order reference is the idempotency key). With the not-configured adapter this
 * returns `not_configured` and never touches the wallet.
 */
export async function creditVerifiedCoinPurchase(
  adapter: CoinPurchaseAdapter,
  deps: CreditDeps,
  input: VerifyCoinPurchaseInput,
): Promise<CreditResult> {
  if (!adapter.configured) {
    return { ok: false, code: "not_configured", message: "Coin purchases are not available yet." };
  }
  let verified: CoinPurchaseResult<VerifiedCoinPurchase>;
  try {
    verified = await adapter.verifyPurchase(input);
  } catch {
    return { ok: false, code: "provider_error", message: "The purchase could not be verified." };
  }
  if (!verified.ok) return { ok: false, code: verified.code, message: verified.message };

  const { orderRef, coins } = verified.value;
  if (!ORDER_REF_PATTERN.test(orderRef) || !Number.isInteger(coins) || coins < 1 || coins > MAX_COINS_PER_PURCHASE) {
    return { ok: false, code: "invalid_purchase", message: "The purchase could not be verified." };
  }
  try {
    const result = await deps.credit(input.userId, coins, orderRef);
    const r = result as { ok?: unknown; applied?: unknown; balance?: unknown } | null;
    if (!r || r.ok !== true || typeof r.applied !== "boolean" || typeof r.balance !== "number") {
      return { ok: false, code: "credit_failed", message: "The purchase could not be credited." };
    }
    return { ok: true, applied: r.applied, balance: r.balance };
  } catch {
    return { ok: false, code: "credit_failed", message: "The purchase could not be credited." };
  }
}
