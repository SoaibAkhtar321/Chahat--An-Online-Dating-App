# Premium promise audit (2026-10-29)

Question: is every benefit the Premium screen promises actually delivered? Checked on the server for Free, Premium,
Plus and VIP members side by side (`supabase/tests/80_premium_promises.sql`, 28 checks) and in the app code.

## Promised and delivered
| Promise (plan card) | Free | Premium | Plus | VIP | Enforced by |
|---|---|---|---|---|---|
| Daily like limit (50, IST reset) | ✅ limited | — | — | — | record_swipe / get_daily_like_quota |
| Unlimited likes | ❌ | ✅ | ✅ | ✅ | record_swipe |
| Video calling per day | 30 s | 300 s (5 min) | 300 s | 300 s | get_my_video_call_allowance, call token TTL |
| See who liked you | ❌ | ✅ | ✅ | ✅ | get_received_likes |
| See the profiles you liked | ❌ | ✅ | ✅ | ✅ | get_my_sent_likes |
| Rewind a pass | ❌ | ✅ | ✅ | ✅ | undo_swipe_pass |
| Read receipts | ❌ | ❌ | ✅ | ✅ | get_chat_list_state |

All 28 checks pass. Expiry and refund removing the benefits is covered by test 78.

## Promises that were NOT delivered (fixed in the app copy)
1. **"priority recommendations"** (Premium hero text): no such feature; the feed is ordered by distance for everyone.
   → Replaced with the real list (unlimited likes, 5 min video/day, who liked you, rewind).
2. **"BEST VALUE" on 1 month**: with ₹499 / 1 month and ₹700 / 2 months, 2 months is cheaper per month.
   → Badge now says "POPULAR".
3. **Me tab "From ₹99"**: old price; the cheapest plan is now the 1-week Premium (₹149). → "See plans"
   (Play shows the real price).
4. **"Manage or cancel subscription"**: prepaid plans don't renew and can't be cancelled. → "View purchases in Google Play".
5. The internal entitlement helper said Plus/VIP had "advanced filters", "priority visibility" and VIP "incognito";
   none exist. Removed (they were not shown on screen, but kept the code honest).

## Still your decision (not code bugs)
* **VIP gives nothing beyond Plus.** The card honestly says "All Plus features", but a buyer paying more gets nothing
  more. Give VIP a real benefit, price it the same as Plus, or stop selling it.
* **Plus ₹199 / VIP ₹399 are cheaper than Premium ₹499** while including more. Set prices in Play Console accordingly.
* **Selfie verification** is switched off for launch (EXPO_PUBLIC_FEATURE_VERIFICATION=false): no screen, badge or promise shows until selfies are reviewed.
* Priority likes are 3/day for everyone; not advertised as paid, so fine.
