// Coin wallet access for the app. Balances and the ledger are READ-ONLY here: the database
// refuses every client write, and all spending happens on the server while a call is metered.
// The numbers shown come from the server; the app never computes what a call costs.
import { supabase, isSupabaseConfigured } from "./supabase";

export interface WalletSummary {
  balance: number;
  /** Value of one coin in paise (50 = INR 0.50). Display only. */
  coinValuePaise: number;
  freeCallSeconds: number;
  audioCoinsPerMinute: number;
  videoCoinsPerMinute: number;
}

export type CoinTransactionKind = "purchase" | "grant" | "refund" | "adjustment" | "call_charge";

export interface CoinTransaction {
  id: string;
  kind: CoinTransactionKind;
  /** Positive for credits, negative for spending. */
  amount: number;
  balanceAfter: number;
  callId: string | null;
  createdAt: string;
}

const KINDS: readonly string[] = ["purchase", "grant", "refund", "adjustment", "call_charge"];

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Strict parse of public.get_my_wallet(); anything unexpected is rejected, never guessed. */
export function parseWalletSummary(data: unknown): WalletSummary | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (
    !isCount(d.balance) ||
    !isCount(d.coin_value_paise) ||
    !isCount(d.free_call_seconds) ||
    !isCount(d.audio_coins_per_minute) ||
    !isCount(d.video_coins_per_minute)
  ) {
    return null;
  }
  return {
    balance: d.balance,
    coinValuePaise: d.coin_value_paise,
    freeCallSeconds: d.free_call_seconds,
    audioCoinsPerMinute: d.audio_coins_per_minute,
    videoCoinsPerMinute: d.video_coins_per_minute,
  };
}

export function parseCoinTransactions(rows: unknown): CoinTransaction[] | null {
  if (!Array.isArray(rows)) return null;
  const parsed: CoinTransaction[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) return null;
    const r = row as Record<string, unknown>;
    if (
      typeof r.id !== "string" ||
      typeof r.kind !== "string" ||
      !KINDS.includes(r.kind) ||
      typeof r.amount !== "number" ||
      !Number.isSafeInteger(r.amount) ||
      !isCount(r.balance_after) ||
      typeof r.created_at !== "string" ||
      (r.call_id !== null && typeof r.call_id !== "string")
    ) {
      return null;
    }
    parsed.push({
      id: r.id,
      kind: r.kind as CoinTransactionKind,
      amount: r.amount,
      balanceAfter: r.balance_after,
      callId: r.call_id as string | null,
      createdAt: r.created_at,
    });
  }
  return parsed;
}

/** Display helper: rupee value of a coin amount (coins * paise / 100). */
export function coinsToRupees(coins: number, coinValuePaise: number): number {
  return Math.round(coins * coinValuePaise) / 100;
}

export async function fetchWalletSummary(): Promise<WalletSummary> {
  if (!isSupabaseConfigured()) throw new Error("The wallet requires a configured backend.");
  const { data, error } = await supabase.rpc("get_my_wallet");
  if (error) throw new Error("Could not load your coin balance.");
  const wallet = parseWalletSummary(data);
  if (!wallet) throw new Error("Could not load your coin balance.");
  return wallet;
}

export async function fetchCoinTransactions(limit = 50): Promise<CoinTransaction[]> {
  if (!isSupabaseConfigured()) throw new Error("The wallet requires a configured backend.");
  const bounded = Math.min(100, Math.max(1, Math.floor(limit)));
  const { data, error } = await supabase
    .from("coin_transactions")
    .select("id, kind, amount, balance_after, call_id, created_at")
    .order("created_at", { ascending: false })
    .limit(bounded);
  if (error) throw new Error("Could not load your coin history.");
  const rows = parseCoinTransactions(data);
  if (!rows) throw new Error("Could not load your coin history.");
  return rows;
}
