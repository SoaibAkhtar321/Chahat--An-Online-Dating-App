// Before opening the call screen, check today's video-call time. When it is used up the user sees the
// Premium option (free plan) or when it renews (paid plans) instead of starting a call that cannot happen.
// The server enforces the same rule in create_video_call; this only avoids a pointless screen.
import { Alert } from "../utils/alert";
import { getUserVideoCallAllowance } from "./subscription";
import { buildNewCallRoute } from "./calls";
import { PAID_ALLOWANCE_USED_MESSAGE, PREMIUM_CALL_MESSAGE } from "./callMedia";
import { isPhoneInAnotherCall, PHONE_BUSY_MESSAGE, PHONE_BUSY_TITLE } from "./deviceCallState";

type RouterLike = { push: (href: any) => void };

export async function startVideoCallIfAllowed(router: RouterLike, matchId: string): Promise<boolean> {
  // Like WhatsApp: no new video call while the phone is already in a phone or WhatsApp call.
  if (isPhoneInAnotherCall()) {
    Alert.alert(PHONE_BUSY_TITLE, PHONE_BUSY_MESSAGE);
    return false;
  }
  let allowance;
  try {
    allowance = await getUserVideoCallAllowance();
  } catch {
    allowance = null;
  }
  // Only block on a definite answer from the server; otherwise the call screen and server decide.
  if (allowance && allowance.valid && allowance.secondsRemaining <= 0) {
    if (allowance.isFree) {
      Alert.alert("Daily video-call time used", PREMIUM_CALL_MESSAGE, [
        { text: "Not now", style: "cancel" },
        { text: "Get Premium", onPress: () => router.push("/premium") },
      ]);
    } else {
      Alert.alert("Daily video-call time used", PAID_ALLOWANCE_USED_MESSAGE);
    }
    return false;
  }
  router.push(buildNewCallRoute(matchId, "video"));
  return true;
}
