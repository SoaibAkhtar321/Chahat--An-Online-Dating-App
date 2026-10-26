import fs from "fs";
import path from "path";
import { buildExistingCallRoute, buildNewCallRoute } from "../mobile/src/services/calls";

jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: jest.fn().mockReturnValue(false),
  supabase: {},
}));

const read = (file: string) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

describe("call entry points pass the right ids", () => {
  it("new calls use the MATCH id and an explicit type", () => {
    expect(buildNewCallRoute("match-9", "video")).toEqual({
      pathname: "/call/[id]",
      params: { id: "match-9", type: "video" },
    });
  });

  it("existing calls carry the match id, the call id and the stored type", () => {
    expect(
      buildExistingCallRoute({ id: "call-3", match_id: "match-9", call_type: "video" }),
    ).toEqual({
      pathname: "/call/[id]",
      params: { id: "match-9", callId: "call-3", type: "video" },
    });
  });

  it("chat and Calls screens build routes only through the shared helpers", () => {
    const chat = read("mobile/app/chat/[id].tsx");
    const calls = read("mobile/app/calls/index.tsx");
    expect(chat).not.toContain('"audio"');
    expect(chat).not.toMatch(/audio call/i);
    expect(chat).toContain('buildNewCallRoute(matchId, "video")');
    expect(chat).not.toMatch(/pathname:\s*"\/call\/\[id\]"/);
    expect(calls).toContain("buildExistingCallRoute(call)");
    expect(calls).not.toContain('"audio"');
    expect(calls).not.toMatch(/voice call|audio call|audio and video|voice or video/i);
    expect(calls).toContain('buildNewCallRoute(m.id, "video")');
    expect(calls).not.toMatch(/pathname:\s*"\/call\/\[id\]"/);
  });
});

describe("calling-enabled UI gating (source-level checks)", () => {
  it("hides call buttons in the Calls screen unless calling is available", () => {
    // The chat screen's video button is intentionally always visible (commit 2145b61 removed its gate).
    const calls = read("mobile/app/calls/index.tsx");
    expect(calls).toContain("const callingAvailable = isCallingAvailable();");
    expect(calls).toMatch(/!callingAvailable \?/);
  });

  it("never creates a call invitation from the call screen when calling is unavailable", () => {
    const screen = read("mobile/app/call/[id].tsx");
    const gate = screen.indexOf("if (!callingAvailable)");
    const create = screen.indexOf("createVideoCall(id, type)");
    expect(gate).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(gate);
  });

  it("hangs up the media session before ending the server call and shows media controls only when connected", () => {
    const screen = read("mobile/app/call/[id].tsx");
    expect(screen.indexOf("await controller?.hangUp()")).toBeLessThan(
      screen.indexOf("transitionVideoCall(callId, status"),
    );
    expect(screen).toContain('const connected = status === "accepted" && media.phase === "connected"');
    expect(screen).toContain("{connected && (");
  });
});