# Google Play Billing Library 8 (2026-10-29)

Google Play no longer accepts apps built with Billing Library 7 (deadline 31 Aug 2026, extension to 1 Nov 2026).
Chahat used `react-native-iap` 12 (Billing 7). It now uses **`expo-iap` 3.4.13**, the Expo version of the same
library family (OpenIAP), which uses **Billing Library 8.3** and works with Expo SDK 54 without extra setup.

## What changed
* `mobile/src/services/subscription.ts`: same flow, new calls:
  `getSubscriptions` → `fetchProducts({type:"subs"})`, `requestSubscription` → `requestPurchase({type:"subs"})`,
  purchase state `"purchased"/"pending"` instead of numbers, cancel code `user-cancelled`.
* `mobile/app.json`: `expo-iap` plugin (adds the `com.android.vending.BILLING` permission).
* Server side unchanged: the app still sends the token to `verify-purchase`, which asks Google, and the purchase is
  acknowledged only after the server grants the plan (otherwise Google refunds it within 3 days).

## Checked here
Type check, lint, 117 Jest suites (9 new purchase-flow tests against a fake store), `expo prebuild -p android`
(module autolinked, BILLING permission present). **Not checked here:** the native Android compile (no Android SDK in
this environment) and a real purchase (needs the Play Console products). Both happen on the first EAS build and the
internal-testing purchase test.

## Test on a phone once the Play products exist
1. Your Gmail is a license tester (Play Console → Settings → License testing).
2. Install from the internal-testing link; Premium screen shows ₹ prices from Play.
3. Buy Premium 1 week → "Subscription verified", Me tab shows "Active until …".
4. Restore purchases on a second install → plan restored.
5. Cancel inside the Play sheet → nothing changes, no error.
