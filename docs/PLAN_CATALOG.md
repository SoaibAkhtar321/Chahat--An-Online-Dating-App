# Chahat plan catalogue (decided 2026-10-28)

All paid plans are **prepaid Google Play subscriptions that do not auto-renew**. There is one pricing system:
prices are set only in Play Console; the app shows Google's localized price and the server never trusts a
price or duration from the app (the end date is Google's verified `expiryTime`).

| Tier | Product ID | Play Console base plan | Intended price | Benefits (server-enforced) |
|---|---|---|---|---|
| Premium | `chahat_premium_1w` | Prepaid, 1 week | ₹149 | Unlimited likes, 5 min/day video, who liked you, profiles you liked, rewind |
| Premium | `chahat_premium_1m` | Prepaid, 1 month | ₹499 | same |
| Premium | `chahat_premium_2m` | Prepaid, 2 months | ₹700 | same |
| Plus | `chahat_plus_1m` | Prepaid, 1 month | **₹199 — needs approval** | Premium + read receipts |
| VIP | `chahat_vip_1m` | Prepaid, 1 month | **₹399 — needs approval** | Plus (no extra benefit today) |

Removed (never sold; pre-launch): `chahat_pkg_149_7d`, `chahat_pkg_299_15d`, `chahat_pkg_499_1m`,
`chahat_premium_3m`, `chahat_premium_6m`, `chahat_premium_12m`. Do not create them in Play Console.

## Decisions still needed

1. **Plus and VIP prices.** The only existing prices are ₹199 (Plus) and ₹399 (VIP), from the old monthly plans.
   With Premium 1 month at ₹499 they would be *cheaper than Premium while including more*. Set Plus/VIP above
   ₹499, or confirm otherwise.
2. **VIP has no benefit beyond Plus.** The "Exclusive VIP Badge" was never built and is no longer advertised.
   Either give VIP a real benefit, price it the same as Plus, or stop selling it.

## Rules the server applies (migration `20260101006300`)

* Same tier again (top-up): the plan ends at the later of the two end dates.
* Higher tier: takes effect immediately and ends with the new plan (remaining lower-tier time is not converted
  into higher-tier time). The app warns before purchase.
* Lower tier while a higher one is active: refused (not acknowledged, so Google refunds it automatically within
  3 days). The app blocks it before purchase.
* Refund / revoke (RTDN) ends the entitlement immediately; expiry ends it at the end date. No renewals.

## Play Console steps

For each product above: Monetize → Subscriptions → Create subscription (product ID exactly as above) → add a
**prepaid** base plan with the listed duration, India price, and "allow extension/top-up" on → Activate.
Then add license testers and test buy, top-up, upgrade (Premium → Plus/VIP), refund, and expiry.
