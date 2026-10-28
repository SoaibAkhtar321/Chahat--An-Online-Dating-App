// Read receipts are Plus/VIP only (20260101005900). The app must never read messages.read_at directly: unread
// badges and the chat-list tick come from get_chat_list_state, marking read goes through mark_chat_read, and the
// chat itself only through get_match_messages. Server-side behaviour: supabase/tests/73_read_receipt_privacy.sql.
import fs from "fs";
import path from "path";

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => mockFrom(...a),
  },
}));
jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: jest.fn().mockResolvedValue({}),
  getSignedUrl: jest.fn().mockResolvedValue(undefined),
  imageFileExtension: jest.fn(),
  sanitizeAndPrepareImageUpload: jest.fn(),
  prepareVoiceUpload: jest.fn(),
}));
jest.mock("../mobile/src/services/discovery", () => ({ DEMO_PROFILES: [] }));
jest.mock("../mobile/src/services/notifications", () => ({ pushNotificationToInbox: jest.fn() }));

import {
  fetchChatListState,
  fetchMessagesForMatch,
  fetchUserMatches,
  markChatRead,
  MESSAGE_COLUMNS,
} from "../mobile/src/services/chat";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MATCH = "33333333-3333-4333-8333-333333333333";
const MSG = "44444444-4444-4444-8444-444444444444";

/** Chainable query builder that records select() columns and resolves to `result`. */
function builder(result: unknown, selects: string[]) {
  const b: any = {};
  for (const fn of ["eq", "neq", "is", "or", "order", "limit", "update", "not"]) b[fn] = jest.fn(() => b);
  b.select = jest.fn((cols: string) => {
    selects.push(cols);
    return b;
  });
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return b;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe("markChatRead", () => {
  it("uses the server RPC and never updates the table directly", async () => {
    mockRpc.mockResolvedValue({ data: 2, error: null });
    await markChatRead(MATCH, ME);
    expect(mockRpc).toHaveBeenCalledWith("mark_chat_read", { _match_id: MATCH });
    expect(mockFrom).not.toHaveBeenCalled();
  });
  it("ignores invalid ids", async () => {
    await markChatRead("not-a-uuid", ME);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("fetchChatListState", () => {
  it("maps counts and only trusts a boolean receipt from the server", async () => {
    mockRpc.mockResolvedValue({
      data: [
        { match_id: MATCH, unread_count: 3, last_message_id: MSG, last_message_read: null },
        { match_id: OTHER, unread_count: -1, last_message_id: null, last_message_read: "yes" },
      ],
      error: null,
    });
    const out = await fetchChatListState([MATCH, OTHER]);
    expect(mockRpc).toHaveBeenCalledWith("get_chat_list_state", { _match_ids: [MATCH, OTHER] });
    expect(out[MATCH]).toEqual({ unreadCount: 3, lastMessageId: MSG, lastMessageRead: null });
    expect(out[OTHER]).toEqual({ unreadCount: 0, lastMessageId: null, lastMessageRead: null });
  });
  it("returns nothing (no badges) on error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await fetchChatListState([MATCH])).toEqual({});
  });
});

describe("fetchUserMatches", () => {
  function setup(lastMessageRead: boolean | null, last: Record<string, unknown>) {
    const selects: string[] = [];
    mockFrom.mockImplementation((table: string) =>
      table === "matches"
        ? builder({ data: [{ id: MATCH, user_a: ME, user_b: OTHER, created_at: "2026-10-01T00:00:00Z" }], error: null }, selects)
        : builder({ data: [last], error: null }, selects),
    );
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "get_chat_list_state") {
        return Promise.resolve({
          data: [{ match_id: MATCH, unread_count: 1, last_message_id: MSG, last_message_read: lastMessageRead }],
          error: null,
        });
      }
      if (fn === "get_public_profile") return Promise.resolve({ data: [{ id: OTHER, name: "Asha", photos: [] }], error: null });
      return Promise.resolve({ data: null, error: null });
    });
    return selects;
  }
  const lastRow = { id: MSG, match_id: MATCH, sender: ME, body: "hi", created_at: "2026-10-02T00:00:00Z", delivered_at: "2026-10-02T00:00:01Z" };

  it("never selects read_at or *, and badges come from the server", async () => {
    const selects = setup(null, lastRow);
    const items = await fetchUserMatches(ME);
    expect(selects.join("|")).not.toMatch(/read_at|\*/);
    expect(items[0].unreadCount).toBe(1);
  });
  it("shows 'read' only when the server confirms it (Plus/VIP), else delivered", async () => {
    setup(null, lastRow);
    expect((await fetchUserMatches(ME))[0].lastMessage?.status).toBe("delivered");
    setup(true, lastRow);
    expect((await fetchUserMatches(ME))[0].lastMessage?.status).toBe("read");
  });
  it("a forged read_at in a row is ignored", async () => {
    setup(null, { ...lastRow, read_at: "2026-10-02T00:00:02Z" });
    expect((await fetchUserMatches(ME))[0].lastMessage?.status).toBe("delivered");
  });
});

describe("fetchMessagesForMatch", () => {
  it("has no direct-table fallback when the RPC fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await fetchMessagesForMatch(MATCH, ME)).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("static guarantees", () => {
  const chat = fs.readFileSync(path.join(__dirname, "../mobile/src/services/chat.ts"), "utf8");
  it("MESSAGE_COLUMNS excludes read_at", () => {
    expect(MESSAGE_COLUMNS.split(/,\s*/)).not.toContain("read_at");
  });
  it("chat.ts never selects * from messages or filters/updates read_at directly", () => {
    expect(chat).not.toMatch(/from\("messages"\)\s*\.select\("\*"/);
    expect(chat).not.toMatch(/\.is\("read_at"/);
    expect(chat).not.toMatch(/update\(\{\s*read_at/);
  });
  it("no other app file reads the messages table", () => {
    const roots = ["mobile/src", "mobile/app"].map((r) => path.join(__dirname, "..", r));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && !p.endsWith(path.join("services", "chat.ts"))) {
          if (/from\(["']messages["']\)/.test(fs.readFileSync(p, "utf8"))) offenders.push(p);
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
  it("the migration replaces table-level SELECT with a column grant without read_at", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20260101005900_read_receipt_privacy.sql"), "utf8");
    expect(sql).toMatch(/REVOKE SELECT ON public\.messages FROM authenticated, anon;/);
    expect(sql).toMatch(/a\.attname <> 'read_at'/);
    expect(sql).toMatch(/IN \('plus', 'vip'\)/);
  });
});
