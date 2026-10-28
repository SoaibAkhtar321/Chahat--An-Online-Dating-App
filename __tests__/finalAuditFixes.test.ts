// Final pre-release audit (2026-10-29): call UX fixes and honest copy.
import fs from "fs";
import path from "path";
import { friendlyCallError, PAID_ALLOWANCE_USED_MESSAGE, PREMIUM_CALL_MESSAGE } from "../mobile/src/services/callMedia";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("call error messages are readable", () => {
  it.each([
    ["Could not create call invitation: A participant already has an active call", /already on a call/],
    ["Could not create call invitation: Too many call attempts", /Too many call attempts/],
    ["Could not create call invitation: Active unblocked match required", /matched with/],
    ["The caller has used today's video-call time. It renews tomorrow.", /renews at midnight/],
    ["Could not update call: Call not found", /no longer available/],
    ["TypeError: Network request failed", /No internet/],
  ])("%s", (raw, expected) => {
    expect(friendlyCallError(new Error(raw), "fallback")).toMatch(expected);
  });

  it("unknown errors never leak database text", () => {
    expect(friendlyCallError(new Error('relation "video_calls" violates check constraint'), "fallback")).toBe("fallback");
  });
});

describe("call screen", () => {
  const screen = read("mobile/app/call/[id].tsx");

  it("checks today's allowance before ringing the other person", () => {
    const check = screen.indexOf("getUserVideoCallAllowance()\n      .then((allowance) => {\n        if (cancelled) return null;");
    expect(check).toBeGreaterThan(0);
    expect(screen.indexOf("return createVideoCall(id, type);")).toBeGreaterThan(check);
  });

  it("paid members are never sold Premium when their 5 minutes are used", () => {
    expect(screen).toMatch(/if \(isFreePlan === false\) setError\(PAID_ALLOWANCE_USED_MESSAGE\)/);
    expect(PAID_ALLOWANCE_USED_MESSAGE).not.toMatch(/Premium/);
    expect(PREMIUM_CALL_MESSAGE).toMatch(/5 minutes/);
  });

  it("timer label matches the plan and front/back camera is available", () => {
    expect(screen).toMatch(/isFreePlan === false \? "Time left today" : "Free time left"/);
    expect(screen).toMatch(/controller\?\.switchCamera\(\)/);
    expect(read("mobile/src/services/agoraCallMedia.tsx")).toMatch(/engine\.switchCamera\(\)/);
  });
});

describe("honest copy", () => {
  it("calls screen states the real allowance", () => {
    const calls = read("mobile/app/calls/index.tsx");
    expect(calls).not.toMatch(/first minute of every\s+call is always free/);
    expect(calls).toMatch(/30 seconds/);
    expect(calls).toMatch(/5 minutes/);
    expect(calls).not.toMatch(/Billing/);
  });

  it("paid members see when their prepaid plan ends", () => {
    expect(read("mobile/app/(tabs)/me.tsx")).toMatch(/Active until/);
    expect(read("mobile/app/premium/index.tsx")).toMatch(/until \$\{new Date\(currentSub\.expiresAt\)/);
  });
});

describe("pre-APK re-audit (2026-10-29)", () => {
  it("a paid member whose 5 minutes end mid-call is not offered Premium", () => {
    const screen = read("mobile/app/call/[id].tsx");
    expect(screen).not.toMatch(/It renews tomorrow/);
    expect(screen).toMatch(/if \(isFreePlan\) setPremiumPrompt\(PREMIUM_CALL_MESSAGE\);\s*else setError\(PAID_ALLOWANCE_USED_MESSAGE\);/);
  });

  it("legal text describes prepaid plans (no renewals, nothing to cancel)", () => {
    const legal = read("mobile/app/legal/index.tsx");
    expect(legal).not.toMatch(/bought and renewed/);
    expect(legal).not.toMatch(/Cancelling stops future charges/);
    expect(legal).toMatch(/do\s+not renew automatically/);
  });

  it("production (AAB) build has the public Supabase config like preview", () => {
    const eas = JSON.parse(read("mobile/eas.json"));
    for (const k of ["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
      expect(eas.build.production.env[k]).toBe(eas.build.preview.env[k]);
    }
    expect(eas.build.production.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toMatch(/^sb_publishable_/);
    expect(JSON.stringify(eas)).not.toMatch(/service_role|sb_secret_/);
  });

  it("unneeded storage write permission is blocked", () => {
    const app = JSON.parse(read("mobile/app.json"));
    expect(app.expo.android.blockedPermissions).toContain("android.permission.WRITE_EXTERNAL_STORAGE");
  });
});
