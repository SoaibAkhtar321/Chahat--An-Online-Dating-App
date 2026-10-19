import * as fs from "fs";
import * as path from "path";
import {
  CALL_ACTION_ANSWER,
  CALL_ACTION_DECLINE,
  CALL_CATEGORY_ID,
  CALL_CHANNEL_ID,
  NOTIFICATION_DEFAULT_ACTION,
  isCallPushData,
  parseCallNotificationData,
  resolveCallNotificationAction,
} from "../mobile/src/services/callNotificationPolicy";
import { shouldPresentInForeground } from "../mobile/src/services/notificationPolicy";
import { buildPushPayload } from "../supabase/functions/dispatch-push/policy";

const CALL = "11111111-1111-4111-8111-111111111111";
const MATCH = "22222222-2222-4222-8222-222222222222";

describe("call notification data", () => {
  it("accepts a well-formed call push and normalises ids", () => {
    expect(
      parseCallNotificationData({ category: "call", callId: CALL.toUpperCase(), matchId: MATCH, callType: "video" }),
    ).toEqual({ callId: CALL, matchId: MATCH, callType: "video" });
  });
  it("keeps the call but drops a malformed match id or unknown call type", () => {
    expect(parseCallNotificationData({ category: "call", callId: CALL, matchId: "nope", callType: "hologram" })).toEqual({
      callId: CALL,
      matchId: null,
      callType: null,
    });
  });
  it.each([
    [null],
    ["string"],
    [{}],
    [{ category: "message", callId: CALL }],
    [{ category: "call" }],
    [{ category: "call", callId: "not-a-uuid" }],
    [{ category: "call", callId: 42 }],
  ])("rejects %j", (data) => {
    expect(parseCallNotificationData(data)).toBeNull();
    expect(isCallPushData(data)).toBe(false);
  });
});

describe("notification action routing", () => {
  it("maps the Answer, Decline and tap actions", () => {
    expect(resolveCallNotificationAction(CALL_ACTION_ANSWER)).toBe("answer");
    expect(resolveCallNotificationAction(CALL_ACTION_DECLINE)).toBe("decline");
    expect(resolveCallNotificationAction(NOTIFICATION_DEFAULT_ACTION)).toBe("open");
  });
  it("ignores unknown or forged action identifiers", () => {
    for (const id of ["", "accept", "ANSWER", undefined, null, 1, "expo.modules.notifications.actions.DISMISS"]) {
      expect(resolveCallNotificationAction(id)).toBeNull();
    }
  });
  it("never shows a call push as a system notification while the app is open", () => {
    expect(shouldPresentInForeground({ category: "call", callId: CALL }, null)).toBe(false);
    expect(shouldPresentInForeground({ category: "call", callId: CALL }, MATCH)).toBe(false);
  });
  it("leaves the existing foreground rules for other categories unchanged", () => {
    expect(shouldPresentInForeground({ category: "like" }, null)).toBe(true);
    expect(shouldPresentInForeground({ category: "message", matchId: MATCH }, MATCH)).toBe(false);
    expect(shouldPresentInForeground({ category: "message", matchId: MATCH }, null)).toBe(true);
  });
});

describe("push payload contract between server and app", () => {
  const payload = buildPushPayload("ExponentPushToken[abc]", "n1", "call", { callId: CALL, matchId: MATCH, callType: "audio" });
  it("uses exactly the channel and category the app registers", () => {
    expect(payload.channelId).toBe(CALL_CHANNEL_ID);
    expect(payload.categoryId).toBe(CALL_CATEGORY_ID);
  });
  it("carries data the app's parser accepts, and nothing identifying the caller", () => {
    expect(parseCallNotificationData(payload.data)).toEqual({ callId: CALL, matchId: MATCH, callType: "audio" });
    expect(Object.keys(payload.data).sort()).toEqual(["callId", "callType", "category", "matchId", "notificationId"]);
    expect(payload.body).toBe("Someone is calling you on Chahat.");
  });
  it("expires with the invitation instead of ringing late", () => {
    expect(payload.ttl).toBe(60);
    expect(payload.priority).toBe("high");
  });
});

describe("Android manifest permissions", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../mobile/app.json"), "utf8")).expo;
  const permissions: string[] = config.android.permissions;
  it("requests the vibrate permission the in-app ring uses", () => {
    expect(permissions).toContain("android.permission.VIBRATE");
  });
  it("does not request full-screen-intent or other call-UI permissions this build does not use", () => {
    expect(permissions).not.toContain("android.permission.USE_FULL_SCREEN_INTENT");
    expect(permissions).not.toContain("android.permission.SYSTEM_ALERT_WINDOW");
    expect(permissions).not.toContain("android.permission.FOREGROUND_SERVICE_PHONE_CALL");
    expect(permissions).not.toContain("android.permission.MANAGE_OWN_CALLS");
  });
  it("blocks the draw-over-other-apps permission Expo's template would otherwise add to release builds", () => {
    expect(config.android.blockedPermissions).toContain("android.permission.SYSTEM_ALERT_WINDOW");
  });
  it("keeps the shipped package id", () => {
    expect(config.android.package).toBe("com.chahat.dating");
  });
});
