const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockChannel = jest.fn();

jest.mock("../mobile/src/services/supabase", () => ({
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
    rpc: (...a: unknown[]) => mockRpc(...a),
    channel: (...a: unknown[]) => mockChannel(...a),
  },
  isSupabaseConfigured: () => true,
}));
jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: jest.fn(async () => ({})),
  getSignedUrl: jest.fn(async () => null),
  imageFileExtension: () => "jpg",
  sanitizeAndPrepareImageUpload: jest.fn(),
  prepareVoiceUpload: jest.fn(),
}));
jest.mock("../mobile/src/services/discovery", () => ({ DEMO_PROFILES: [{ id: "demo" }] }));
jest.mock("../mobile/src/services/notifications", () => ({ pushNotificationToInbox: jest.fn(async () => null) }));

import { fetchReactionsForMatch, setMessageReaction, subscribeToMatchMessages } from "../mobile/src/services/chat";
import {
  REACTION_EMOJIS,
  applyReactionRow,
  buildReactionMap,
  clearMessageReactions,
  isAllowedReaction,
  mapReactionRow,
  nextReaction,
  summarizeReactions,
} from "../mobile/src/utils/reactions";

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const MATCH = "f6c60000-0000-4000-8000-000000000001";
const MSG = "11111111-1111-4111-8111-111111111111";
const MSG2 = "22222222-2222-4222-8222-222222222222";

beforeEach(() => jest.clearAllMocks());

describe("reaction helpers", () => {
  it("only the fixed emoji set is allowed", () => {
    expect(REACTION_EMOJIS.every((e) => isAllowedReaction(e))).toBe(true);
    expect(isAllowedReaction("🍕")).toBe(false);
    expect(isAllowedReaction("")).toBe(false);
    expect(isAllowedReaction(null)).toBe(false);
  });

  it("maps rows and treats unknown or null emoji as removed", () => {
    expect(mapReactionRow({ message_id: MSG, user_id: ME, emoji: "👍" })).toEqual({ messageId: MSG, userId: ME, emoji: "👍" });
    expect(mapReactionRow({ message_id: MSG, user_id: ME, emoji: null })?.emoji).toBeNull();
    expect(mapReactionRow({ message_id: MSG, user_id: ME, emoji: "🍕" })?.emoji).toBeNull();
    expect(mapReactionRow({ user_id: ME, emoji: "👍" })).toBeNull();
    expect(mapReactionRow(null)).toBeNull();
  });

  it("one reaction per user per message: a new emoji replaces the old, null removes", () => {
    let map = applyReactionRow({}, { messageId: MSG, userId: ME, emoji: "👍" });
    map = applyReactionRow(map, { messageId: MSG, userId: ME, emoji: "❤️" });
    expect(map).toEqual({ [MSG]: { [ME]: "❤️" } });
    map = applyReactionRow(map, { messageId: MSG, userId: THEM, emoji: "😂" });
    map = applyReactionRow(map, { messageId: MSG, userId: ME, emoji: null });
    expect(map).toEqual({ [MSG]: { [THEM]: "😂" } });
    map = applyReactionRow(map, { messageId: MSG, userId: THEM, emoji: null });
    expect(map).toEqual({});
  });

  it("returns the same object when nothing changes", () => {
    const map = { [MSG]: { [ME]: "👍" } };
    expect(applyReactionRow(map, { messageId: MSG, userId: ME, emoji: "👍" })).toBe(map);
    expect(applyReactionRow(map, { messageId: MSG2, userId: ME, emoji: null })).toBe(map);
    expect(clearMessageReactions(map, MSG2)).toBe(map);
  });

  it("builds a map from rows and clears one message", () => {
    const map = buildReactionMap([
      { messageId: MSG, userId: ME, emoji: "👍" },
      { messageId: MSG2, userId: THEM, emoji: "🙏" },
    ]);
    expect(Object.keys(map)).toHaveLength(2);
    expect(clearMessageReactions(map, MSG)).toEqual({ [MSG2]: { [THEM]: "🙏" } });
  });

  it("summarizes: biggest group first, ties in emoji order, flags mine", () => {
    const chips = summarizeReactions({ [ME]: "😂", [THEM]: "👍", c: "😂", d: "❤️" }, ME);
    expect(chips).toEqual([
      { emoji: "😂", count: 2, mine: true },
      { emoji: "👍", count: 1, mine: false },
      { emoji: "❤️", count: 1, mine: false },
    ]);
    expect(summarizeReactions(undefined, ME)).toEqual([]);
  });

  it("tapping your own reaction again removes it", () => {
    expect(nextReaction(null, "👍")).toBe("👍");
    expect(nextReaction("👍", "👍")).toBeNull();
    expect(nextReaction("👍", "❤️")).toBe("❤️");
  });
});

describe("setMessageReaction", () => {
  it("calls the server function and reports success", async () => {
    mockRpc.mockResolvedValueOnce({ data: { success: true, emoji: "👍" }, error: null });
    await expect(setMessageReaction(MSG, "👍")).resolves.toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith("set_message_reaction", { _message_id: MSG, _emoji: "👍" });
  });

  it("sends null to remove", async () => {
    mockRpc.mockResolvedValueOnce({ data: { success: true, emoji: null }, error: null });
    await setMessageReaction(MSG, null);
    expect(mockRpc).toHaveBeenCalledWith("set_message_reaction", { _message_id: MSG, _emoji: null });
  });

  it("surfaces server refusals, network errors and bad ids without throwing", async () => {
    mockRpc.mockResolvedValueOnce({ data: { success: false, error: "message_not_found" }, error: null });
    await expect(setMessageReaction(MSG, "👍")).resolves.toEqual({ success: false, error: "message_not_found" });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(setMessageReaction(MSG, "👍")).resolves.toEqual({ success: false, error: "network" });
    mockRpc.mockRejectedValueOnce(new Error("offline"));
    await expect(setMessageReaction(MSG, "👍")).resolves.toEqual({ success: false, error: "network" });
    await expect(setMessageReaction("not-a-uuid", "👍")).resolves.toEqual({ success: false, error: "message_not_found" });
  });
});

describe("fetchReactionsForMatch", () => {
  const builder = (result: unknown) => {
    const b: any = {};
    for (const m of ["select", "eq", "not", "order", "limit"]) b[m] = jest.fn(() => b);
    b.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
    return b;
  };

  it("reads only live reactions of this match and maps them", async () => {
    const b = builder({
      data: [
        { message_id: MSG, user_id: ME, emoji: "👍" },
        { message_id: MSG, user_id: THEM, emoji: "🍕" },
      ],
      error: null,
    });
    mockFrom.mockReturnValueOnce(b);
    const rows = await fetchReactionsForMatch(MATCH);
    expect(mockFrom).toHaveBeenCalledWith("message_reactions");
    expect(b.eq).toHaveBeenCalledWith("match_id", MATCH);
    expect(b.not).toHaveBeenCalledWith("emoji", "is", null);
    expect(rows).toEqual([
      { messageId: MSG, userId: ME, emoji: "👍" },
      { messageId: MSG, userId: THEM, emoji: null },
    ]);
  });

  it("returns [] on error or invalid id", async () => {
    mockFrom.mockReturnValueOnce(builder({ data: null, error: { message: "x" } }));
    await expect(fetchReactionsForMatch(MATCH)).resolves.toEqual([]);
    await expect(fetchReactionsForMatch("nope")).resolves.toEqual([]);
  });
});

describe("subscribeToMatchMessages reactions", () => {
  it("listens for reaction INSERT/UPDATE on this match only (never DELETE) and forwards mapped rows", () => {
    const callbacks: Array<{ filter: any; cb: (p: any) => void }> = [];
    const channel: any = {
      on: jest.fn((_t: string, filter: any, cb: any) => {
        callbacks.push({ filter, cb });
        return channel;
      }),
      subscribe: jest.fn(() => channel),
    };
    mockChannel.mockReturnValueOnce(channel);
    const onReaction = jest.fn();
    subscribeToMatchMessages(MATCH, () => undefined, ME, { onReaction });

    const reaction = callbacks.filter((c) => c.filter.table === "message_reactions");
    expect(reaction.map((c) => c.filter.event).sort()).toEqual(["INSERT", "UPDATE"]);
    expect(reaction.every((c) => c.filter.filter === `match_id=eq.${MATCH}`)).toBe(true);

    reaction[0]!.cb({ new: { message_id: MSG, user_id: THEM, emoji: "❤️" } });
    expect(onReaction).toHaveBeenCalledWith({ messageId: MSG, userId: THEM, emoji: "❤️" });
    reaction[1]!.cb({ new: { message_id: null } });
    expect(onReaction).toHaveBeenCalledTimes(1);
  });
});
