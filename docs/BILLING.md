# Coin wallet and call billing (Phase 4)

Status: database, server and client plumbing are implemented and tested. **No payment provider is
integrated, no coin pack or price exists, and no call provider is integrated**, so nothing can be
bought, charged or metered in production until those are approved and added.

## Rules (all configurable in `app_settings`, enforced only on the server)

| Rule | Default | Setting key |
|---|---|---|
| Value of one coin | 1 coin = INR 0.50 (50 paise), display only | `coin_value_paise` |
| Voice call | 4 coins per minute | `call_rate_audio_coins_per_minute` |
| Video call | 10 coins per minute | `call_rate_video_coins_per_minute` |
| Free time at the start of a call | 60 seconds | `call_free_seconds` (10..3600) |
| Pre-buy the next minute when this many seconds of covered time remain | 20 | `call_extension_lead_seconds` (1..50) |
| Premium, Plus and VIP callers | exempt, never charged | subscription tier |

- **The caller pays.** The recipient is never charged. A free caller calling a premium recipient is
  still metered; a premium caller calling a free recipient is exempt. (Product decision to confirm.)
- Rates and the free window are **snapshotted when the call is accepted**, so changing a setting
  cannot reprice a call that is already running.
- A missing setting uses the default above. A malformed or out-of-range value makes billing **fail
  closed** (an error), never a silently wrong charge.

## How a call is metered (and why durations cannot be forged)

No call provider is integrated, so there is no provider-reported duration. Rather than trust a
client-reported one, the server meters time itself:

1. `transition_video_call(accept)` decides on the server whether the caller is exempt and sets
   `free_call_until` (accepted time + free window). Exempt calls have `free_call_until = NULL`.
2. `free_call_until` is the time the server has **authorised**. Join tokens never outlive it.
3. Shortly before it runs out, a participant's app asks `issue-call-token` for a fresh token. After
   it has authenticated the user, rate-limited, authorised the call and confirmed a configured
   provider, the function calls `extend_call_coverage` (service role). That locks the call row,
   re-checks entitlements, and if the lead time has been reached charges the **caller** one minute
   through the ledger (idempotency key `call:<id>:minute:<n>`) and extends `free_call_until` by 60 s.
4. If the caller cannot pay, the response is `402 insufficient_coins`, no token is issued, and the
   call ends when its authorised time ends. The wallet is never negative.
5. When a call ends by any path (explicit end, lazy expiry sweep, ineligibility), a database trigger
   settles it: the **server-derived duration** is `min(ended_at, free_call_until) - accepted_at`
   (capped at 24 h), minutes that were pre-bought but not started are refunded, and `settled_at`
   makes this idempotent (ledger key `call:<id>:settle`).

Consequences: a call shorter than the free window costs nothing; a forgotten call is never timed or
billed beyond what was authorised; no function accepts a duration from a client.

**Limitation (documented, not hidden).** Without a provider we cannot observe media actually
flowing. Billing is therefore a prepaid-minute model: a participant who is connected when a minute is
pre-bought pays for that minute if it starts. When a real provider is added, its webhook (room
ended / participant left) should call the same ending transition so settlement uses real end times;
it must never replace server metering with client-supplied times.

## Data model (migration `20260101002400_coin_wallet_and_call_billing.sql`)

- `coin_wallets(user_id, balance)`: `CHECK (balance >= 0)`, ceiling 10^12.
- `coin_transactions`: append-only ledger (`purchase`, `grant`, `refund`, `adjustment`,
  `call_charge`), signed amount, `balance_after`, unique `idempotency_key`, optional `call_id`
  (no foreign key so the ledger outlives call rows). `UPDATE`, `DELETE` and `TRUNCATE` are blocked by
  triggers for everyone, including the table owner; the only permitted delete is the cascade when the
  owning auth user is deleted (account deletion).
- `video_calls` gained `billing_exempt`, `billing_rate_coins`, `billing_free_seconds`,
  `billed_minutes`, `coins_charged`, `duration_seconds`, `settled_at`. Clients can no longer
  `SELECT` those columns (column-level grant), so a recipient cannot see what the caller spent.

## Access control

| Object | anon | authenticated | service_role |
|---|---|---|---|
| `coin_wallets`, `coin_transactions` | none | SELECT own rows only (RLS); ledger idempotency keys and metadata hidden by column grant | SELECT only |
| `apply_coin_transaction` (the only balance mutation) | none | none | none (called only inside other definer functions) |
| `credit_coins_from_purchase` | none | none | execute |
| `extend_call_coverage`, `get_call_join_context` | none | none | execute |
| `get_my_wallet` | none | execute (own balance, rates) | |

Every mutation is `SECURITY DEFINER` with a fixed `search_path`. Lock order is always: call row,
then the idempotency-key advisory lock, then the wallet row, so concurrent charges, refunds and
credits serialise without deadlocks. Replaying a key with identical parameters is a no-op; reusing it
with different parameters raises.

## Coin purchases: not configured

`supabase/functions/_shared/coinPurchase.ts` defines the adapter interface, `resolveCoinPurchaseAdapter`
(returns the explicit not-configured adapter unless `COIN_PURCHASE_ADAPTER` selects a registered
adapter that has its credentials) and `creditVerifiedCoinPurchase`, which credits only what the
adapter verified, keyed by the store's order reference. **No adapter is registered, no pack or price is
defined, and no Edge Function endpoint calls it yet.** The client (`mobile/src/services/coinPurchase.ts`)
reports "unavailable" and never simulates a purchase; `EXPO_PUBLIC_FEATURE_COIN_TOPUP` must stay
`false`. To add a store later (needs approval): implement and register the adapter, add the verifying
Edge Function that calls `creditVerifiedCoinPurchase`, define the server-side catalogue, then enable the flag.

## Tests

```powershell
npx jest __tests__/callBilling.test.ts __tests__/coinPurchase.test.ts __tests__/coins.test.ts __tests__/issueCallToken.test.ts __tests__/callToken.test.ts
npm test
npm run lint
bash supabase/tests/run.sh   # disposable local PostgreSQL 16 only; see supabase/tests/README.md
```

Database coverage (`43_coin_billing.sql`, `46_coin_concurrency.sh`): RLS and grants for anon, clients,
strangers and service_role; append-only ledger; overspend refusal; idempotent credits and settlement;
free-minute, exact-billing, refund and forgotten-call cases; premium, upgrade-mid-call and expired
tier; setting snapshots and fail-closed settings; cascade on account deletion; and concurrent
extensions, overspend, duplicate purchases, shared idempotency keys and extend/end races. Removing
the row or advisory locks makes the concurrency tests fail (checked by mutation).
