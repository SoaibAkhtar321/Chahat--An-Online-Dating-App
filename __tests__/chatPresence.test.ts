const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const MATCH = "f6c60000-0000-4000-8000-000000000001";

let presenceCb: (() => void) | undefined;
let broadcastCb: ((p: any) => void) | undefined;
let statusCb: ((s: string) => void) | undefined;
let presenceState: Record<string, unknown[]> = {};
let appStateCb: ((s: string) => void) | undefined;
const mockRemoveSub = jest.fn();

const mockChannel: any = {
  on: jest.fn((type: string, filter: any, cb: any) => {
    if (type === "presence") presenceCb = cb;
    if (type === "broadcast") broadcastCb = cb;
    return mockChannel;
  }),
  subscribe: jest.fn((cb: any) => {
    statusCb = cb;
    return mockChannel;
  }),
  presenceState: jest.fn(() => presenceState),
  track: jest.fn(async () => "ok"),
  untrack: jest.fn(async () => "ok"),
  send: jest.fn(async () => "ok"),
};
const mockSupabase: any = {
  channel: jest.fn(() => mockChannel),
  removeChannel: jest.fn(async () => "ok"),
};

jest.mock("../mobile/src/services/supabase", () => ({ get supabase() { return mockSupabase; } }));
jest.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_e: string, cb: (s: string) => void) => {
      appStateCb = cb;
      return { remove: mockRemoveSub };
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { joinChatPresence } = require("../mobile/src/services/chatPresence");

const join = () => {
  const handlers = { onPartnerOnline: jest.fn(), onPartnerTyping: jest.fn() };
  const presence = joinChatPresence(MATCH, ME, handlers);
  return { handlers, presence };
};

beforeEach(() => {
  jest.clearAllMocks();
  presenceState = {};
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe("joinChatPresence", () => {
  it("uses one channel per match, keyed by the user, and tracks presence once subscribed", () => {
    join();
    expect(mockSupabase.channel).toHaveBeenCalledWith(`chat_presence_${MATCH}`, {
      config: { presence: { key: ME }, broadcast: { self: false } },
    });
    expect(mockChannel.track).not.toHaveBeenCalled();
    statusCb!("SUBSCRIBED");
    expect(mockChannel.track).toHaveBeenCalledWith({ online: true });
  });

  it("reports the partner online only for someone else's presence key", () => {
    const { handlers } = join();
    presenceState = { [ME]: [{}] };
    presenceCb!();
    expect(handlers.onPartnerOnline).toHaveBeenLastCalledWith(false);
    presenceState = { [ME]: [{}], [THEM]: [{}] };
    presenceCb!();
    expect(handlers.onPartnerOnline).toHaveBeenLastCalledWith(true);
  });

  it("shows partner typing, ignores own echo, and clears typing when the partner goes offline", () => {
    const { handlers } = join();
    broadcastCb!({ payload: { userId: ME, typing: true } });
    expect(handlers.onPartnerTyping).not.toHaveBeenCalled();
    broadcastCb!({ payload: { userId: THEM, typing: true } });
    expect(handlers.onPartnerTyping).toHaveBeenLastCalledWith(true);
    presenceState = {};
    presenceCb!();
    expect(handlers.onPartnerTyping).toHaveBeenLastCalledWith(false);
  });

  it("broadcasts typing only after the channel is subscribed, then stopped on notifyStopped", () => {
    const { presence } = join();
    presence.notifyInput(true);
    expect(mockChannel.send).not.toHaveBeenCalled();
    statusCb!("SUBSCRIBED");
    presence.notifyInput(true);
    expect(mockChannel.send).toHaveBeenCalledWith({ type: "broadcast", event: "typing", payload: { userId: ME, typing: true } });
    presence.notifyStopped();
    expect(mockChannel.send).toHaveBeenLastCalledWith({ type: "broadcast", event: "typing", payload: { userId: ME, typing: false } });
  });

  it("goes offline in the background and back online in the foreground", () => {
    join();
    statusCb!("SUBSCRIBED");
    mockChannel.track.mockClear();
    appStateCb!("background");
    expect(mockChannel.untrack).toHaveBeenCalled();
    appStateCb!("active");
    expect(mockChannel.track).toHaveBeenCalledWith({ online: true });
  });

  it("leave sends a final stopped, removes the channel and the AppState listener, and is idempotent", () => {
    const { presence } = join();
    statusCb!("SUBSCRIBED");
    presence.notifyInput(true);
    presence.leave();
    presence.leave();
    expect(mockChannel.send).toHaveBeenLastCalledWith({ type: "broadcast", event: "typing", payload: { userId: ME, typing: false } });
    expect(mockSupabase.removeChannel).toHaveBeenCalledTimes(1);
    expect(mockRemoveSub).toHaveBeenCalledTimes(1);
  });

  it("never throws when Realtime is unavailable", () => {
    mockSupabase.channel.mockImplementationOnce(() => { throw new Error("no realtime"); });
    const { presence } = join();
    expect(() => { presence.notifyInput(true); presence.notifyStopped(); presence.leave(); }).not.toThrow();
  });
});
