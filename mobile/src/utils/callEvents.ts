// Call history lines in the chat. The server writes them as `system` messages with the body
// `call|video|<outcome>|<call_id>|<seconds>` (see 20260101005500_call_connect_clock_and_history.sql).
// The caller is the message sender, so the wording depends on who is looking.

export type CallOutcome = "missed" | "declined" | "ended";

export interface CallEvent {
  outcome: CallOutcome;
  callId: string;
  seconds: number;
}

export function parseCallEvent(body: string | null | undefined): CallEvent | null {
  if (typeof body !== "string" || !body.startsWith("call|")) return null;
  const [, kind, outcome, callId, secs] = body.split("|");
  if (kind !== "video") return null;
  if (outcome !== "missed" && outcome !== "declined" && outcome !== "ended") return null;
  const seconds = Number.parseInt(secs ?? "0", 10);
  return { outcome, callId: callId ?? "", seconds: Number.isFinite(seconds) ? seconds : 0 };
}

export function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** `isMine` is true when the viewer placed the call. */
export function callEventLabel(event: CallEvent, isMine: boolean): string {
  switch (event.outcome) {
    case "missed":
      return isMine ? "No answer" : "Missed video call";
    case "declined":
      return isMine ? "Video call declined" : "You declined a video call";
    case "ended":
      return `${isMine ? "Outgoing" : "Incoming"} video call · ${formatCallDuration(event.seconds)}`;
  }
}

export function isMissedForViewer(event: CallEvent, isMine: boolean): boolean {
  return event.outcome === "missed" && !isMine;
}

/** Friendly text for non-bubble places (chat list preview). Passes other bodies through unchanged. */
export function previewForSystemBody(body: string, isMine: boolean): string {
  const event = parseCallEvent(body);
  return event ? `📹 ${callEventLabel(event, isMine)}` : body;
}
