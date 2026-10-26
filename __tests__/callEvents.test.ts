import {
  callEventLabel,
  formatCallDuration,
  isMissedForViewer,
  parseCallEvent,
  previewForSystemBody,
} from "../mobile/src/utils/callEvents";

describe("call history lines", () => {
  it("parses the server body format", () => {
    expect(parseCallEvent("call|video|missed|abc|0")).toEqual({ outcome: "missed", callId: "abc", seconds: 0 });
    expect(parseCallEvent("call|video|ended|abc|23")).toEqual({ outcome: "ended", callId: "abc", seconds: 23 });
  });

  it("ignores anything that is not a call line", () => {
    expect(parseCallEvent("hello")).toBeNull();
    expect(parseCallEvent("call|audio|missed|abc|0")).toBeNull();
    expect(parseCallEvent("call|video|weird|abc|0")).toBeNull();
    expect(parseCallEvent(undefined)).toBeNull();
  });

  it("words the line by who is looking", () => {
    const missed = parseCallEvent("call|video|missed|c|0")!;
    expect(callEventLabel(missed, false)).toBe("Missed video call");
    expect(callEventLabel(missed, true)).toBe("No answer");
    expect(isMissedForViewer(missed, false)).toBe(true);
    expect(isMissedForViewer(missed, true)).toBe(false);
    const ended = parseCallEvent("call|video|ended|c|75")!;
    expect(callEventLabel(ended, true)).toBe("Outgoing video call · 1:15");
    expect(callEventLabel(ended, false)).toBe("Incoming video call · 1:15");
  });

  it("formats durations and chat-list previews", () => {
    expect(formatCallDuration(5)).toBe("0:05");
    expect(formatCallDuration(600)).toBe("10:00");
    expect(previewForSystemBody("call|video|missed|c|0", false)).toContain("Missed video call");
    expect(previewForSystemBody("plain system text", false)).toBe("plain system text");
  });
});
