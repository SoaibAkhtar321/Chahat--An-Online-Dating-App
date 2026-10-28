// Notification coverage audit (2026-10-28): every event reaches a closed app, calls ring with the bundled
// ringtone, and an unanswered call sends a "Missed video/audio call" push that opens the chat.
import fs from "fs";
import path from "path";
import { buildPushPayload } from "../supabase/functions/dispatch-push/policy";
import { resolveNotificationDestination, shouldPresentInForeground } from "../mobile/src/services/notificationPolicy";
import { CALL_CHANNEL_ID, CALL_RINGTONE_FILE, parseCallNotificationData } from "../mobile/src/services/callNotificationPolicy";

const CALL = "11111111-1111-4111-8111-111111111111";
const MATCH = "22222222-2222-4222-8222-222222222222";
const ME = "33333333-3333-4333-8333-333333333333";

describe("missed-call push", () => {
  const payload = buildPushPayload("ExponentPushToken[x]", "n1", "missed_call", {
    callId: CALL, matchId: MATCH, callType: "video",
  });
  it("says 'Missed video call', opens the chat, and uses the normal (non-ringing) channel", () => {
    expect(payload.title).toBe("Missed video call");
    expect(payload.data).toMatchObject({ category: "missed_call", matchId: MATCH, callId: CALL, callType: "video" });
    expect(payload.channelId).toBe("default");
    expect(payload.categoryId).toBeUndefined();
    expect(payload.ttl).toBe(3600);
  });
  it("never names the caller (lock-screen privacy, same as the ringing push)", () => {
    const named = buildPushPayload("t", "n2", "missed_call", { matchId: MATCH, callType: "audio" }, { senderName: "Asha" });
    expect(JSON.stringify(named)).not.toContain("Asha");
    expect(named.title).toBe("Missed audio call");
  });
  it("is not mistaken for a ringing call by the app (no Answer/Decline)", () => {
    expect(parseCallNotificationData(payload.data)).toBeNull();
  });
  it("tapping it opens the chat with that match; it is shown even if the app is open elsewhere", () => {
    expect(resolveNotificationDestination("missed_call", MATCH, ME, { id: MATCH, user_a: ME, user_b: "x" }))
      .toEqual({ kind: "chat", matchId: MATCH });
    expect(shouldPresentInForeground(payload.data, null)).toBe(true);
    expect(shouldPresentInForeground(payload.data, MATCH)).toBe(false);
  });
});

describe("incoming call rings with the app closed", () => {
  const ring = buildPushPayload("t", "n3", "call", { callId: CALL, matchId: MATCH, callType: "video" });
  it("goes to the high-importance ringing channel with Answer/Decline, high priority, 60 s TTL", () => {
    expect(ring.channelId).toBe(CALL_CHANNEL_ID);
    expect(ring.categoryId).toBe("incoming_call");
    expect(ring.priority).toBe("high");
    expect(ring.ttl).toBe(60);
    expect(ring.title).toBe("Incoming video call");
  });
  it("the ringing channel's ringtone is bundled into the build by the expo-notifications plugin", () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, "../mobile/app.json"), "utf8"));
    const plugin = app.expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-notifications");
    expect(plugin[1].sounds.map((s: string) => path.basename(s))).toContain(CALL_RINGTONE_FILE);
    expect(fs.existsSync(path.join(__dirname, "../mobile/assets/sounds", CALL_RINGTONE_FILE))).toBe(true);
  });
});

describe("every event category produces a push", () => {
  it.each([
    ["like", "Someone likes you"],
    ["match", "It's a match!"],
    ["message", "New message"],
    ["call", "Incoming call"],
    ["missed_call", "Missed call"],
  ] as const)("%s", (category, title) => {
    expect(buildPushPayload("t", "n", category, {}).title).toBe(title);
  });
});
