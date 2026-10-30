const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockChannel = jest.fn();
const mockGetSignedUrls = jest.fn(async (_bucket: string, paths: string[]) =>
  Object.fromEntries(paths.map((p) => [p, `signed:${p}`])),
);
const mockGetSignedUrl = jest.fn(async (_bucket: string, path: string) => `signed:${path}`);
const mockPushToInbox = jest.fn(async () => null);

jest.mock("../mobile/src/services/supabase", () => ({
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
    rpc: (...a: unknown[]) => mockRpc(...a),
    channel: (...a: unknown[]) => mockChannel(...a),
  },
  isSupabaseConfigured: () => true,
}));
jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: (...a: [string, string[]]) => mockGetSignedUrls(...a),
  getSignedUrl: (...a: [string, string]) => mockGetSignedUrl(...a),
  imageFileExtension: () => "jpg",
  sanitizeAndPrepareImageUpload: jest.fn(),
  prepareVoiceUpload: jest.fn(),
}));
jest.mock("../mobile/src/services/discovery", () => ({ DEMO_PROFILES: [{ id: "demo" }] }));
jest.mock("../mobile/src/services/notifications", () => ({
  pushNotificationToInbox: (...a: unknown[]) => mockPushToInbox(...(a as [])),
}));

import { fetchMessagesForMatch, fetchUserMatches, subscribeToMatchMessages } from "../mobile/src/services/chat";

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const MATCH = "f6c60000-0000-4000-8000-000000000001";
const MSG = "11111111-1111-4111-8111-111111111111";

/** Awaitable query-builder double: every chain method returns itself, awaiting yields `result`. */
function query(result: unknown) {
  const b: any = {};
  for (const m of ["select", "eq", "neq", "is", "or", "order", "limit"]) b[m] = jest.fn(() => b);
  b.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return b;
}

function setupMatchList(opts: { lastRow: any | null; unreadQueries: Array<ReturnType<typeof query>> }) {
  const matchQuery = query({ data: [{ id: MATCH, user_a: ME, user_b: THEM, created_at: "2026-10-01T00:00:00Z" }], error: null });
  const lastQuery = query({ data: opts.lastRow ? [opts.lastRow] : [], error: null });
  const unread = [...opts.unreadQueries];
  let messagesCalls = 0;
  mockFrom.mockImplementation((table: string) => {
    if (table === "matches") return matchQuery;
    messagesCalls++;
    return messagesCalls === 1 ? lastQuery : unread.shift()!;
  });
  mockRpc.mockImplementation(async (name: string) => {
    if (name === "get_public_profile") return { data: [{ id: THEM, name: "Ananya", photos: [] }], error: null };
    return { data: null, error: null };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Phase 3B: unread counts and chat-list previews", () => {
  it("takes unread counts from the server (get_chat_list_state), never from read_at on the table", async () => {
    setupMatchList({ lastRow: null, unreadQueries: [] });
    const base = mockRpc.getMockImplementation()!;
    mockRpc.mockImplementation(async (name: string, args: unknown) =>
      name === "get_chat_list_state"
        ? { data: [{ match_id: MATCH, unread_count: 2, last_message_id: null, last_message_read: null }], error: null }
        : base(name, args),
    );

    const items = await fetchUserMatches(ME);

    expect(items[0]!.unreadCount).toBe(2);
    expect(mockRpc).toHaveBeenCalledWith("get_chat_list_state", { _match_ids: [MATCH] });
    // Only the last-message preview reads the table, with explicit columns (no read_at, no *).
    expect(mockFrom.mock.calls.filter(([t]) => t === "messages")).toHaveLength(1);
  });

  it("shows no unread badge (0) when the server state cannot be read", async () => {
    setupMatchList({ lastRow: null, unreadQueries: [] });

    const items = await fetchUserMatches(ME);

    expect(items[0]!.unreadCount).toBe(0);
  });

  it("previews a deleted last message as a content-free tombstone and never signs media for it", async () => {
    setupMatchList({
      lastRow: {
        id: MSG,
        match_id: MATCH,
        sender: THEM,
        body: "",
        image_path: "stale/path.jpg",
        audio_path: null,
        message_type: "text",
        created_at: "2026-10-20T00:00:00Z",
        read_at: null,
        deleted_at: "2026-10-20T00:05:00Z",
      },
      unreadQueries: [query({ count: 0, error: null })],
    });

    const items = await fetchUserMatches(ME);
    const last = items[0]!.lastMessage!;

    expect(last.deletedAt).toBe("2026-10-20T00:05:00Z");
    expect(last.text).toBe("");
    expect(last.image).toBeUndefined();
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it("still previews a normal last message (the list never downloads its media)", async () => {
    setupMatchList({
      lastRow: {
        id: MSG,
        match_id: MATCH,
        sender: THEM,
        body: "see this",
        image_path: "m/img.jpg",
        audio_path: null,
        message_type: "image",
        created_at: "2026-10-20T00:00:00Z",
        read_at: null,
        deleted_at: null,
      },
      unreadQueries: [query({ count: 1, error: null })],
    });

    const last = (await fetchUserMatches(ME))[0]!.lastMessage!;
    expect(last.text).toBe("see this");
    // Scale (2026-10-30): the chat list shows text only, so it no longer signs the last message's photo/voice URL.
    expect(last.image).toBeUndefined();
    expect(last.messageType).toBe("image");
    expect(last.deletedAt).toBeUndefined();
  });
});

describe("Phase 3B: fetching a thread", () => {
  const live = {
    id: "22222222-2222-4222-8222-222222222222",
    match_id: MATCH,
    sender: THEM,
    body: "hi",
    image_path: "m/a.jpg",
    audio_path: null,
    message_type: "image",
    is_view_once: false,
    viewed_at: null,
    created_at: "2026-10-20T00:00:00Z",
    read_at: null,
    deleted_at: null,
  };
  const tomb = {
    ...live,
    id: MSG,
    sender: ME,
    body: "",
    image_path: "m/should-not-be-signed.jpg",
    created_at: "2026-10-20T00:01:00Z",
    deleted_at: "2026-10-20T00:05:00Z",
  };

  it("returns tombstones from get_match_messages without content and signs only live media", async () => {
    mockRpc.mockResolvedValue({ data: [live, tomb], error: null });

    const msgs = await fetchMessagesForMatch(MATCH, ME);

    expect(mockGetSignedUrls).toHaveBeenCalledWith("chat", ["m/a.jpg"]);
    expect(msgs[0]).toMatchObject({ text: "hi", image: "signed:m/a.jpg", deletedAt: null });
    expect(msgs[1]).toMatchObject({ id: MSG, text: "", deletedAt: "2026-10-20T00:05:00Z", messageType: "text" });
    expect(msgs[1]!.image).toBeUndefined();
  });

  it("has no direct-table fallback: an RPC failure returns nothing and never reads the table", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "function not found" } });

    const msgs = await fetchMessagesForMatch(MATCH, ME);

    expect(msgs).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockGetSignedUrls).not.toHaveBeenCalled();
  });
});

describe("Phase 3B: Realtime subscription", () => {
  function fakeChannel() {
    const listeners: Array<{ event: string; cb: (p: any) => void }> = [];
    let statusCb: ((status: string) => void) | undefined;
    const channel: any = {
      on: jest.fn((_type: string, cfg: { event: string }, cb: (p: any) => void) => {
        listeners.push({ event: cfg.event, cb });
        return channel;
      }),
      subscribe: jest.fn((cb?: (status: string) => void) => {
        statusCb = cb;
        return channel;
      }),
    };
    mockChannel.mockReturnValue(channel);
    return {
      channel,
      fire: (event: string, payload: unknown) => listeners.filter((l) => l.event === event).forEach((l) => l.cb(payload)),
      status: (s: string) => statusCb?.(s),
    };
  }

  it("listens for both INSERT and UPDATE on this match only", () => {
    const fake = fakeChannel();
    subscribeToMatchMessages(MATCH, jest.fn(), ME);
    const configs = fake.channel.on.mock.calls.map((c: any[]) => c[1]).filter((c: any) => c.table === "messages");
    expect(configs.map((c: any) => c.event).sort()).toEqual(["INSERT", "UPDATE"]);
    for (const c of configs) expect(c).toMatchObject({ table: "messages", filter: `match_id=eq.${MATCH}` });
    // reactions share the channel but only INSERT/UPDATE (a Realtime DELETE cannot be filtered per match)
    const reactionEvents = fake.channel.on.mock.calls
      .map((c: any[]) => c[1])
      .filter((c: any) => c.table === "message_reactions")
      .map((c: any) => c.event)
      .sort();
    expect(reactionEvents).toEqual(["INSERT", "UPDATE"]);
  });

  it("maps an INSERT row to the client Message shape before handing it over", () => {
    const fake = fakeChannel();
    const onReceived = jest.fn();
    subscribeToMatchMessages(MATCH, onReceived, ME);

    fake.fire("INSERT", {
      new: { id: MSG, match_id: MATCH, sender: THEM, body: "hello", created_at: "2026-10-20T00:00:00Z", message_type: "text" },
    });

    expect(onReceived).toHaveBeenCalledTimes(1);
    expect(onReceived.mock.calls[0][0]).toMatchObject({ id: MSG, from: "them", text: "hello", matchId: MATCH });
    expect(typeof onReceived.mock.calls[0][0].at).toBe("number");
  });

  it("reports an UPDATE that carries deleted_at as a deletion", () => {
    const fake = fakeChannel();
    const onDeleted = jest.fn();
    subscribeToMatchMessages(MATCH, jest.fn(), ME, { onMessageDeleted: onDeleted });

    fake.fire("UPDATE", { new: { id: MSG, match_id: MATCH, body: "", deleted_at: "2026-10-20T00:05:00Z" } });

    expect(onDeleted).toHaveBeenCalledWith({ id: MSG, deletedAt: "2026-10-20T00:05:00Z" });
  });

  it("ignores UPDATEs that are not deletions (read receipts stay masked)", () => {
    const fake = fakeChannel();
    const onDeleted = jest.fn();
    subscribeToMatchMessages(MATCH, jest.fn(), ME, { onMessageDeleted: onDeleted });

    fake.fire("UPDATE", { new: { id: MSG, match_id: MATCH, read_at: "2026-10-20T00:06:00Z", deleted_at: null } });
    fake.fire("UPDATE", { new: null });

    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("asks for a resync only when the channel re-subscribes, not on the first subscription", () => {
    const fake = fakeChannel();
    const onResync = jest.fn();
    subscribeToMatchMessages(MATCH, jest.fn(), ME, { onResync });

    fake.status("SUBSCRIBED");
    expect(onResync).not.toHaveBeenCalled();
    fake.status("CHANNEL_ERROR");
    fake.status("SUBSCRIBED");
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("still queues an in-app notice for a message from the other person", () => {
    const fake = fakeChannel();
    subscribeToMatchMessages(MATCH, jest.fn(), ME);
    fake.fire("INSERT", {
      new: { id: MSG, match_id: MATCH, sender: THEM, body: "hello", created_at: "2026-10-20T00:00:00Z" },
    });
    expect(mockPushToInbox).toHaveBeenCalledTimes(1);
  });
});
