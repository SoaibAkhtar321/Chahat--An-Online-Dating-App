const mockInsert = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockRemove = jest.fn(async (..._a: unknown[]) => ({ error: null }));
const mockUpload = jest.fn(async (..._a: unknown[]) => ({ error: null }));

jest.mock("../mobile/src/services/supabase", () => ({
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
    rpc: (...a: unknown[]) => mockRpc(...a),
    storage: { from: () => ({ upload: (...a: unknown[]) => mockUpload(...a), remove: (...a: unknown[]) => mockRemove(...a) }) },
  },
  isSupabaseConfigured: () => true,
}));
jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: jest.fn(async () => ({})),
  getSignedUrl: jest.fn(async () => "https://signed/x"),
  imageFileExtension: () => "jpg",
  sanitizeAndPrepareImageUpload: jest.fn(async () => ({ blob: {}, mimeType: "image/jpeg" })),
  prepareVoiceUpload: jest.fn(async () => ({ blob: {}, mimeType: "audio/m4a", extension: "m4a" })),
}));
jest.mock("../mobile/src/services/discovery", () => ({ DEMO_PROFILES: [{ id: "demo" }] }));
jest.mock("../mobile/src/services/notifications", () => ({ pushNotificationToInbox: jest.fn(async () => null) }));

import { fetchMessagesForMatch, sendChatMessage, sendVoiceMessage } from "../mobile/src/services/chat";
import { appendIncoming, mapMessageRow, tombstoneMessage } from "../mobile/src/utils/messageState";
import {
  REPLY_SNIPPET_MAX,
  REPLY_TARGET_UNAVAILABLE,
  buildReplyPreview,
  canReplyTo,
  fillReplyPreviews,
  hasUnresolvedReplies,
  isReplyUnavailable,
  mergeReplyPreviews,
  replyAuthorLabel,
  replyPreviewFromRow,
  replySnippet,
} from "../mobile/src/utils/replies";
import type { Message } from "../mobile/src/types";

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const MATCH = "f6c60000-0000-4000-8000-000000000001";
const ORIG = "11111111-1111-4111-8111-111111111111";
const REPLY = "22222222-2222-4222-8222-222222222222";

const msg = (over: Partial<Message>): Message => ({
  id: ORIG,
  matchId: MATCH,
  sender: THEM,
  from: "them",
  text: "original text",
  messageType: "text",
  at: 1000,
  status: "sent",
  ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
  id: REPLY,
  match_id: MATCH,
  sender: ME,
  body: "my answer",
  message_type: "text",
  created_at: "2026-10-22T10:00:00Z",
  read_at: null,
  delivered_at: null,
  deleted_at: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
  mockFrom.mockImplementation(() => ({ insert: (...a: unknown[]) => mockInsert(...a) }));
});

describe("reply preview from a server row", () => {
  it("a message that is not a reply has no reply fields at all", () => {
    const m = mapMessageRow(row(), ME);
    expect(m.replyToId).toBeUndefined();
    expect(m.replyTo).toBeUndefined();
  });

  it("maps the server preview (sender seen from my side, text, kind)", () => {
    const m = mapMessageRow(
      row({ reply_to_id: ORIG, reply_sender: THEM, reply_body: "original text", reply_kind: "text", reply_unavailable: false }),
      ME,
    );
    expect(m.replyToId).toBe(ORIG);
    expect(m.replyTo).toEqual({ id: ORIG, from: "them", text: "original text", kind: "text", unavailable: false });
    const mine = mapMessageRow(
      row({ reply_to_id: ORIG, reply_sender: ME, reply_body: "x", reply_kind: "text", reply_unavailable: false }),
      ME,
    );
    expect(mine.replyTo?.from).toBe("me");
  });

  it("photo and voice originals carry no text; an unavailable original carries nothing", () => {
    const photo = replyPreviewFromRow(
      { reply_to_id: ORIG, reply_sender: THEM, reply_body: "caption", reply_kind: "image", reply_unavailable: false },
      ME,
    );
    expect(photo).toMatchObject({ kind: "image", text: "" });
    const voice = replyPreviewFromRow(
      { reply_to_id: ORIG, reply_sender: THEM, reply_body: null, reply_kind: "voice", reply_unavailable: false },
      ME,
    );
    expect(voice).toMatchObject({ kind: "voice", text: "" });
    const gone = replyPreviewFromRow(
      { reply_to_id: ORIG, reply_sender: THEM, reply_body: "secret", reply_kind: "text", reply_unavailable: true },
      ME,
    );
    expect(gone).toEqual({ id: ORIG, from: null, text: "", kind: "text", unavailable: true });
  });

  it("a Realtime or fallback row with only reply_to_id keeps the link and leaves the preview unresolved", () => {
    const m = mapMessageRow(row({ reply_to_id: ORIG }), ME);
    expect(m.replyToId).toBe(ORIG);
    expect(m.replyTo).toBeUndefined();
  });

  it("caps the snippet length", () => {
    const p = replyPreviewFromRow(
      { reply_to_id: ORIG, reply_sender: THEM, reply_body: "y".repeat(500), reply_kind: "text", reply_unavailable: false },
      ME,
    );
    expect(p?.text.length).toBe(REPLY_SNIPPET_MAX);
  });

  it("a message deleted for everyone never carries a reply", () => {
    const m = mapMessageRow(row({ body: "", deleted_at: "2026-10-22T10:05:00Z", reply_to_id: ORIG, reply_body: "leak" }), ME);
    expect(m.replyToId).toBeUndefined();
    expect(m.replyTo).toBeUndefined();
    const t = tombstoneMessage(msg({ replyToId: ORIG, replyTo: buildReplyPreview(msg({})) }), "2026-10-22T10:05:00Z");
    expect(t.replyToId).toBeUndefined();
    expect(t.replyTo).toBeUndefined();
  });
});

describe("building and showing a quote locally", () => {
  it("quotes text, photos and voice notes like the server does", () => {
    expect(buildReplyPreview(msg({}))).toEqual({ id: ORIG, from: "them", text: "original text", kind: "text", unavailable: false });
    expect(buildReplyPreview(msg({ messageType: "image", image: "https://x/i.jpg", text: "caption" }))).toMatchObject({ kind: "image", text: "" });
    expect(buildReplyPreview(msg({ messageType: "voice", audio: "https://x/a.m4a" }))).toMatchObject({ kind: "voice", text: "" });
    expect(buildReplyPreview(msg({ text: "z".repeat(500) })).text.length).toBe(REPLY_SNIPPET_MAX);
  });

  it("a deleted original is quoted as unavailable, without content", () => {
    expect(buildReplyPreview(msg({ deletedAt: "2026-10-22T10:00:00Z", text: "" }))).toMatchObject({ unavailable: true, text: "", from: null });
  });

  it("snippet and author labels", () => {
    expect(replySnippet(buildReplyPreview(msg({})))).toBe("original text");
    expect(replySnippet(buildReplyPreview(msg({ messageType: "image", image: "u" })))).toBe("Photo");
    expect(replySnippet(buildReplyPreview(msg({ messageType: "voice", audio: "u" })))).toBe("Voice message");
    expect(replySnippet({ id: ORIG, from: null, text: "", kind: "text", unavailable: true })).toBe("Original message unavailable");
    expect(replyAuthorLabel(buildReplyPreview(msg({ from: "me" })), "Ananya")).toBe("You");
    expect(replyAuthorLabel(buildReplyPreview(msg({ from: "them" })), "Ananya")).toBe("Ananya");
    expect(replyAuthorLabel({ id: ORIG, from: null, text: "", kind: "text", unavailable: true }, "Ananya")).toBe("");
  });

  it("only messages with content can be replied to", () => {
    expect(canReplyTo(msg({}))).toBe(true);
    expect(canReplyTo(msg({ deletedAt: "2026-10-22T10:00:00Z" }))).toBe(false);
    expect(canReplyTo(msg({ status: "failed" }))).toBe(false);
    expect(canReplyTo(null)).toBe(false);
  });
});

describe("unavailable quotes follow the live deletion state", () => {
  const reply = msg({ id: REPLY, from: "me", sender: ME, replyToId: ORIG, replyTo: buildReplyPreview(msg({})) });
  const none = { hidden: new Set<string>(), tombstones: new Map<string, string>() };

  it("is available while the original is intact", () => {
    expect(isReplyUnavailable(reply, [msg({}), reply], none)).toBe(false);
    expect(isReplyUnavailable(msg({}), [], none)).toBe(false);
  });

  it("becomes unavailable when the original is deleted for me, deleted for everyone, or tombstoned in the list", () => {
    expect(isReplyUnavailable(reply, [reply], { ...none, hidden: new Set([ORIG]) })).toBe(true);
    expect(isReplyUnavailable(reply, [msg({}), reply], { ...none, tombstones: new Map([[ORIG, "t"]]) })).toBe(true);
    expect(isReplyUnavailable(reply, [msg({ deletedAt: "t", text: "" }), reply], none)).toBe(true);
  });

  it("a rollback (state restored) makes the quote available again", () => {
    expect(isReplyUnavailable(reply, [msg({}), reply], none)).toBe(false);
  });

  it("a server-side unavailable quote stays unavailable", () => {
    const gone = msg({ id: REPLY, replyToId: ORIG, replyTo: { id: ORIG, from: null, text: "", kind: "text", unavailable: true } });
    expect(isReplyUnavailable(gone, [gone], none)).toBe(true);
  });
});

describe("resolving quotes that arrive without a preview", () => {
  const original = msg({});
  const bare = msg({ id: REPLY, from: "me", sender: ME, replyToId: ORIG });

  it("fills the quote from the original when it is in the list; leaves others alone", () => {
    const [filled] = fillReplyPreviews([bare], [original]);
    expect(filled!.replyTo).toMatchObject({ id: ORIG, text: "original text", from: "them" });
    const list = [bare];
    expect(fillReplyPreviews(list, [])).toBe(list);
    expect(hasUnresolvedReplies(list)).toBe(true);
    expect(hasUnresolvedReplies([filled!])).toBe(false);
  });

  it("an incoming Realtime reply is quoted from the chat when possible", () => {
    const ctx = { hidden: new Set<string>(), tombstones: new Map<string, string>() };
    const next = appendIncoming([original], bare, ctx);
    expect(next[1]!.replyTo?.text).toBe("original text");
    const unresolved = appendIncoming([], bare, ctx);
    expect(unresolved[0]!.replyTo).toBeUndefined();
  });

  it("merges server previews into unresolved replies only, without adding, removing or reordering anything", () => {
    const fetched = [original, { ...bare, replyTo: { id: ORIG, from: "them" as const, text: "from server", kind: "text" as const, unavailable: false } }];
    const list = [bare, msg({ id: "33333333-3333-4333-8333-333333333333", text: "other", at: 3000 })];
    const merged = mergeReplyPreviews(list, fetched);
    expect(merged.map((m) => m.id)).toEqual(list.map((m) => m.id));
    expect(merged[0]!.replyTo?.text).toBe("from server");
    const done = [merged[0]!];
    expect(mergeReplyPreviews(done, fetched)).toBe(done);
  });
});

describe("sending a reply", () => {
  it("sendChatMessage stores reply_to_id and returns it on the message", async () => {
    const res = await sendChatMessage(MATCH, ME, "hello", undefined, false, ORIG);
    expect(res.success).toBe(true);
    expect(mockInsert.mock.calls[0]![0]).toMatchObject({ match_id: MATCH, sender: ME, body: "hello", reply_to_id: ORIG });
    expect(res.message?.replyToId).toBe(ORIG);
  });

  it("a normal message sends no reply_to_id key at all", async () => {
    await sendChatMessage(MATCH, ME, "hello");
    expect(Object.keys(mockInsert.mock.calls[0]![0])).not.toContain("reply_to_id");
  });

  it("turns the database refusal into the reply-unavailable code", async () => {
    mockInsert.mockResolvedValue({ error: { message: "reply_target_unavailable" } });
    const res = await sendChatMessage(MATCH, ME, "hello", undefined, false, ORIG);
    expect(res).toEqual({ success: false, error: REPLY_TARGET_UNAVAILABLE });
  });

  it("other insert errors keep their own message", async () => {
    mockInsert.mockResolvedValue({ error: { message: "boom" } });
    const res = await sendChatMessage(MATCH, ME, "hello", undefined, false, ORIG);
    expect(res).toEqual({ success: false, error: "boom" });
  });

  it("a photo that could not be inserted is removed from storage again", async () => {
    mockInsert.mockResolvedValue({ error: { message: "reply_target_unavailable" } });
    const res = await sendChatMessage(MATCH, ME, "", "file:///p.jpg", false, ORIG);
    expect(res.success).toBe(false);
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(String((mockRemove.mock.calls[0]![0] as string[])[0])).toContain(`${MATCH}/`);
  });

  it("sendVoiceMessage replies too, and maps the same refusal", async () => {
    const ok = await sendVoiceMessage(MATCH, ME, "file:///a.m4a", 5, "audio/m4a", ORIG);
    expect(ok.success).toBe(true);
    expect(mockInsert.mock.calls[0]![0]).toMatchObject({ message_type: "voice", reply_to_id: ORIG });
    expect(ok.message?.replyToId).toBe(ORIG);

    mockInsert.mockResolvedValue({ error: { message: "reply_target_unavailable" } });
    const refused = await sendVoiceMessage(MATCH, ME, "file:///a.m4a", 5, "audio/m4a", ORIG);
    expect(refused).toEqual({ success: false, error: REPLY_TARGET_UNAVAILABLE });
    expect(mockRemove).toHaveBeenCalled();
  });

  it("a voice note without a reply sends no reply_to_id key", async () => {
    await sendVoiceMessage(MATCH, ME, "file:///a.m4a", 5, "audio/m4a");
    expect(Object.keys(mockInsert.mock.calls[0]![0])).not.toContain("reply_to_id");
  });
});

describe("loading a chat with replies", () => {
  it("uses the server preview from get_match_messages", async () => {
    mockRpc.mockResolvedValue({
      error: null,
      data: [
        row({ id: ORIG, sender: THEM, body: "original text" }),
        row({ reply_to_id: ORIG, reply_sender: THEM, reply_body: "original text", reply_kind: "text", reply_unavailable: false }),
      ],
    });
    const list = await fetchMessagesForMatch(MATCH, ME);
    expect(list).toHaveLength(2);
    expect(list[1]!.replyTo).toMatchObject({ id: ORIG, from: "them", text: "original text" });
  });

  it("falls back to quoting from the same page when only reply_to_id is available", async () => {
    // Rows without server-built reply previews (e.g. an older get_match_messages). There is no direct-table
    // fallback any more (it cannot apply the read-receipt rule, 20260101005900).
    mockRpc.mockResolvedValue({
      error: null,
      data: [row({ id: ORIG, sender: THEM, body: "original text" }), row({ reply_to_id: ORIG })],
    });
    const list = await fetchMessagesForMatch(MATCH, ME);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(list[1]!.replyTo).toMatchObject({ id: ORIG, text: "original text", from: "them" });
  });
});
