const mockRpc = jest.fn();
const mockConfigured = jest.fn(() => true);

jest.mock("../mobile/src/services/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
  isSupabaseConfigured: () => mockConfigured(),
}));

import {
  RETRY_DELAYS_MS,
  canDeleteForEveryone,
  canDeleteForMe,
  classifyRpcError,
  deleteMessage,
  deleteMessageForEveryone,
  deleteMessageForMe,
} from "../mobile/src/services/messageDeletion";
import {
  appendIncoming,
  applyTombstone,
  insertChronologically,
  mapMessageRow,
  messagePreviewText,
  reconcileFetched,
  removeMessage,
  tombstoneMessage,
} from "../mobile/src/utils/messageState";
import type { Message } from "../mobile/src/types";

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const MATCH = "f6c60000-0000-4000-8000-000000000001";
const MSG = "11111111-1111-4111-8111-111111111111";
const noSleep = jest.fn(async () => undefined);

beforeEach(() => {
  mockRpc.mockReset();
  noSleep.mockClear();
  mockConfigured.mockReturnValue(true);
});

describe("Phase 3B: delete RPC client", () => {
  it("calls delete_message_for_me with the Phase 3A argument name", async () => {
    mockRpc.mockResolvedValue({ data: { success: true, status: "deleted_for_me", message_id: MSG }, error: null });
    const res = await deleteMessageForMe(MSG, { sleep: noSleep });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("delete_message_for_me", { _message_id: MSG });
    expect(res).toMatchObject({ ok: true, status: "deleted_for_me", messageId: MSG, attempts: 1 });
  });

  it("calls delete_message_for_everyone and returns the server tombstone time", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, status: "deleted", message_id: MSG, deleted_at: "2026-10-20T01:00:00Z" },
      error: null,
    });
    const res = await deleteMessageForEveryone(MSG, { sleep: noSleep });
    expect(mockRpc).toHaveBeenCalledWith("delete_message_for_everyone", { _message_id: MSG });
    expect(res).toMatchObject({ ok: true, status: "deleted", deletedAt: "2026-10-20T01:00:00Z" });
  });

  it("treats already_deleted as success (the RPCs are idempotent)", async () => {
    mockRpc.mockResolvedValue({
      data: { success: true, status: "already_deleted", message_id: MSG, deleted_at: "2026-10-19T10:00:00Z" },
      error: null,
    });
    const res = await deleteMessage("everyone", MSG, { sleep: noSleep });
    expect(res).toMatchObject({ ok: true, status: "already_deleted", deletedAt: "2026-10-19T10:00:00Z" });
  });

  it.each(["message_not_found", "forbidden", "account_not_active", "account_deletion_pending"] as const)(
    "maps the server result '%s' to a permanent failure without retrying",
    async (code) => {
      mockRpc.mockResolvedValue({ data: { success: false, error: code }, error: null });
      const res = await deleteMessage("everyone", MSG, { sleep: noSleep });
      expect(res).toMatchObject({ ok: false, reason: code, retryable: false, attempts: 1 });
      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(noSleep).not.toHaveBeenCalled();
    },
  );

  it("does not invent a contract: an unknown server error code becomes 'unknown'", async () => {
    mockRpc.mockResolvedValue({ data: { success: false, error: "something_new" }, error: null });
    const res = await deleteMessage("me", MSG, { sleep: noSleep });
    expect(res).toMatchObject({ ok: false, reason: "unknown", retryable: false });
  });

  it("rejects a malformed response instead of reporting success", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await deleteMessage("me", MSG, { sleep: noSleep })).toMatchObject({ ok: false, reason: "unknown" });
    mockRpc.mockResolvedValue({ data: { status: "deleted" }, error: null });
    expect(await deleteMessage("me", MSG, { sleep: noSleep })).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("reports a missing RPC (migration not applied) as 'unavailable' and never retries", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.delete_message_for_me(_message_id)" },
      status: 404,
    });
    const res = await deleteMessage("me", MSG, { sleep: noSleep });
    expect(res).toMatchObject({ ok: false, reason: "unavailable", retryable: false, attempts: 1 });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("reports an unauthenticated caller as 'auth_required' and never retries", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "Authentication required" }, status: 400 });
    const res = await deleteMessage("me", MSG, { sleep: noSleep });
    expect(res).toMatchObject({ ok: false, reason: "auth_required", retryable: false });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("retries connectivity failures with backoff and succeeds on the third attempt", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: "TypeError: Network request failed" } })
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce({ data: { success: true, status: "deleted_for_me", message_id: MSG }, error: null });
    const res = await deleteMessage("me", MSG, { sleep: noSleep });
    expect(res).toMatchObject({ ok: true, attempts: 3 });
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(noSleep.mock.calls.map((c) => c[0])).toEqual([...RETRY_DELAYS_MS]);
  });

  it("gives up after 3 attempts and returns a retryable failure", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "Network request failed" } });
    const res = await deleteMessage("everyone", MSG, { sleep: noSleep });
    expect(res).toMatchObject({ ok: false, reason: "network", retryable: true, attempts: 3 });
    expect(mockRpc).toHaveBeenCalledTimes(3);
  });

  it("retries on HTTP 5xx / 429 but not on 4xx", async () => {
    expect(classifyRpcError({ message: "bad gateway" }, 502)).toEqual({ reason: "network", retryable: true });
    expect(classifyRpcError({ message: "slow down" }, 429)).toEqual({ reason: "network", retryable: true });
    expect(classifyRpcError({ message: "bad request", code: "22P02" }, 400)).toEqual({ reason: "unknown", retryable: false });
  });

  it("rejects ids that are not UUIDs without calling the server", async () => {
    const res = await deleteMessage("me", "msg_123_abc", { sleep: noSleep });
    expect(res).toMatchObject({ ok: false, reason: "invalid_id", retryable: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("local preview without a backend succeeds locally and sends nothing", async () => {
    mockConfigured.mockReturnValue(false);
    const me = await deleteMessage("me", MSG, { sleep: noSleep });
    const everyone = await deleteMessage("everyone", MSG, { sleep: noSleep });
    expect(me).toMatchObject({ ok: true, local: true, status: "deleted_for_me" });
    expect(everyone).toMatchObject({ ok: true, local: true, status: "deleted" });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("Phase 3B: who may see which action", () => {
  const mine = { id: MSG, sender: ME, deletedAt: null };
  const theirs = { id: MSG, sender: THEM, deletedAt: null };

  it("Delete for me is offered for either participant's message", () => {
    expect(canDeleteForMe(mine)).toBe(true);
    expect(canDeleteForMe(theirs)).toBe(true);
    expect(canDeleteForMe({ id: "not-a-uuid" })).toBe(false);
  });

  it("Delete for everyone only for the current user's own live message", () => {
    expect(canDeleteForEveryone(mine, ME)).toBe(true);
    expect(canDeleteForEveryone(theirs, ME)).toBe(false);
    expect(canDeleteForEveryone({ ...mine, deletedAt: "2026-10-20T00:00:00Z" }, ME)).toBe(false);
    expect(canDeleteForEveryone({ ...mine, id: "nope" }, ME)).toBe(false);
    expect(canDeleteForEveryone(mine, null)).toBe(false);
    expect(canDeleteForEveryone(mine, undefined)).toBe(false);
  });
});

const msg = (over: Partial<Message> = {}): Message => ({
  id: MSG,
  matchId: MATCH,
  sender: ME,
  from: "me",
  text: "hello",
  at: 1000,
  status: "sent",
  messageType: "text",
  ...over,
});
const none = { hidden: new Set<string>(), tombstones: new Map<string, string>() };

describe("Phase 3B: message state helpers", () => {
  it("mapMessageRow keeps the live shape the chat screen already relied on", () => {
    const m = mapMessageRow(
      {
        id: MSG,
        match_id: MATCH,
        sender: THEM,
        body: "hi",
        image_path: "p/img.jpg",
        audio_path: null,
        audio_duration_sec: null,
        message_type: "image",
        is_view_once: true,
        viewed_at: null,
        created_at: "2026-10-20T00:00:00Z",
        read_at: "2026-10-20T00:01:00Z",
        deleted_at: null,
      },
      ME,
      { "p/img.jpg": "https://signed/img" },
    );
    expect(m).toMatchObject({
      id: MSG,
      matchId: MATCH,
      from: "them",
      text: "hi",
      image: "https://signed/img",
      messageType: "image",
      isViewOnce: true,
      status: "read",
      deletedAt: null,
    });
  });

  it("mapMessageRow strips all content from a tombstone even if the row still carries some", () => {
    const m = mapMessageRow(
      {
        id: MSG,
        match_id: MATCH,
        sender: ME,
        body: "secret",
        image_path: "p/img.jpg",
        audio_path: "p/a.m4a",
        audio_duration_sec: 9,
        message_type: "voice",
        created_at: "2026-10-20T00:00:00Z",
        deleted_at: "2026-10-20T00:05:00Z",
      },
      ME,
      { "p/img.jpg": "https://signed/img", "p/a.m4a": "https://signed/a" },
    );
    expect(m.deletedAt).toBe("2026-10-20T00:05:00Z");
    expect(m.text).toBe("");
    expect(m.image).toBeUndefined();
    expect(m.audio).toBeUndefined();
    expect(m.audioDurationSec).toBeUndefined();
    expect(m.messageType).toBe("text");
  });

  it("applyTombstone scrubs a present message once and ignores unknown ids", () => {
    const list = [msg({ image: "https://x", text: "hello" })];
    const next = applyTombstone(list, MSG, "2026-10-20T00:05:00Z");
    expect(next).not.toBe(list);
    expect(next[0]).toMatchObject({ id: MSG, text: "", deletedAt: "2026-10-20T00:05:00Z", messageType: "text" });
    expect(next[0]!.image).toBeUndefined();
    expect(applyTombstone(next, MSG, "2026-10-20T09:00:00Z")).toBe(next);
    expect(applyTombstone(list, "22222222-2222-4222-8222-222222222222", "x")).toBe(list);
  });

  it("appendIncoming never duplicates, never re-adds a hidden message, never shows tombstoned content", () => {
    const base = [msg({ id: "a", at: 1 })];
    expect(appendIncoming(base, msg({ id: "a" }), none)).toBe(base);
    expect(appendIncoming(base, msg({ id: "b" }), { ...none, hidden: new Set(["b"]) })).toBe(base);

    const withTomb = appendIncoming(base, msg({ id: "c", text: "leak" }), {
      ...none,
      tombstones: new Map([["c", "2026-10-20T00:05:00Z"]]),
    });
    expect(withTomb).toHaveLength(2);
    expect(withTomb[1]).toMatchObject({ id: "c", text: "", deletedAt: "2026-10-20T00:05:00Z" });
  });

  it("reconcileFetched drops hidden messages and re-scrubs a stale copy of a deleted one", () => {
    const fetched = [msg({ id: "keep", text: "k" }), msg({ id: "hid", text: "h" }), msg({ id: "dead", text: "old content" })];
    const out = reconcileFetched(fetched, {
      hidden: new Set(["hid"]),
      tombstones: new Map([["dead", "2026-10-20T00:05:00Z"]]),
    });
    expect(out.map((m) => m.id)).toEqual(["keep", "dead"]);
    expect(out[1]).toMatchObject({ text: "", deletedAt: "2026-10-20T00:05:00Z" });
  });

  it("insertChronologically restores a message at its place and replaces instead of duplicating", () => {
    const list = [msg({ id: "1", at: 10 }), msg({ id: "3", at: 30 })];
    const restored = insertChronologically(list, msg({ id: "2", at: 20 }));
    expect(restored.map((m) => m.id)).toEqual(["1", "2", "3"]);
    const replaced = insertChronologically(restored, msg({ id: "2", at: 20, text: "updated" }));
    expect(replaced.map((m) => m.id)).toEqual(["1", "2", "3"]);
    expect(replaced[1]!.text).toBe("updated");
  });

  it("removeMessage keeps the same array when nothing matches", () => {
    const list = [msg({ id: "1" })];
    expect(removeMessage(list, "zzz")).toBe(list);
    expect(removeMessage(list, "1")).toEqual([]);
  });

  it("tombstoneMessage keeps identity, side and time only", () => {
    const t = tombstoneMessage(msg({ image: "x", audio: "y", audioDurationSec: 4, isViewOnce: true }), "2026-10-20T00:05:00Z");
    expect(t).toEqual({
      id: MSG,
      matchId: MATCH,
      sender: ME,
      from: "me",
      text: "",
      messageType: "text",
      isViewOnce: false,
      viewedAt: null,
      deletedAt: "2026-10-20T00:05:00Z",
      at: 1000,
      status: "sent",
    });
  });

  it("messagePreviewText never exposes the content of a deleted message", () => {
    expect(messagePreviewText(msg({ text: "hello" }))).toBe("hello");
    expect(messagePreviewText(msg({ text: "" }))).toBe("Shared an image");
    expect(messagePreviewText(msg({ text: "secret", deletedAt: "2026-10-20T00:05:00Z" }))).toBe("You deleted this message");
    expect(messagePreviewText(msg({ from: "them", sender: THEM, text: "secret", deletedAt: "2026-10-20T00:05:00Z" }))).toBe(
      "This message was deleted",
    );
    expect(messagePreviewText(undefined)).toBe("");
  });
});
