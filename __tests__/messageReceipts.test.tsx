import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);
jest.mock("expo-image", () => {
  const { View } = require("react-native");
  return { Image: View };
});
jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t: any, k: string) => (k in t ? t[k] : () => null) }));
jest.mock("../mobile/src/services/voiceMedia", () => ({
  getAudioPlayerAdapter: () => ({ playAsync: jest.fn(), stopAsync: jest.fn(), pauseAsync: jest.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ChatBubble } = require("../mobile/src/components/chat/ChatBubble");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mapMessageRow, mergeReceipts, messageStatusFromRow } = require("../mobile/src/utils/messageState");

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const row = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  match_id: "f6c60000-0000-4000-8000-000000000001",
  sender: ME,
  body: "hi",
  created_at: "2026-10-21T10:00:00Z",
  read_at: null,
  delivered_at: null,
  deleted_at: null,
  ...over,
});

describe("messageStatusFromRow / mapMessageRow", () => {
  it("maps the three tick states", () => {
    expect(messageStatusFromRow(row())).toBe("sent");
    expect(messageStatusFromRow(row({ delivered_at: "2026-10-21T10:00:05Z" }))).toBe("delivered");
    expect(messageStatusFromRow(row({ delivered_at: "x", read_at: "2026-10-21T10:01:00Z" }))).toBe("read");
    expect(messageStatusFromRow(row({ read_at: "2026-10-21T10:01:00Z" }))).toBe("read");
  });

  it("carries the status through mapMessageRow", () => {
    expect(mapMessageRow(row({ delivered_at: "x" }), ME).status).toBe("delivered");
  });
});

describe("mergeReceipts", () => {
  const mine = (over: Record<string, unknown> = {}) => mapMessageRow(row(over), ME);

  it("upgrades my messages forward only", () => {
    const list = [mine()];
    const merged = mergeReceipts(list, [mine({ delivered_at: "x" })]);
    expect(merged[0].status).toBe("delivered");
    const read = mergeReceipts(merged, [mine({ delivered_at: "x", read_at: "y" })]);
    expect(read[0].status).toBe("read");
    // never downgrades (e.g. a masked fetch)
    expect(mergeReceipts(read, [mine()])[0].status).toBe("read");
  });

  it("returns the same array when nothing changed", () => {
    const list = [mine({ delivered_at: "x" })];
    expect(mergeReceipts(list, [mine({ delivered_at: "x" })])).toBe(list);
  });

  it("never touches incoming, failed, tombstoned or unknown messages and adds nothing", () => {
    const incoming = mapMessageRow(row({ id: "22222222-2222-4222-8222-222222222222", sender: THEM }), ME);
    const failed = { ...mine({ id: "33333333-3333-4333-8333-333333333333" }), status: "failed" as const };
    const tomb = mapMessageRow(row({ id: "44444444-4444-4444-8444-444444444444", deleted_at: "z", body: "" }), ME);
    const list = [incoming, failed, tomb];
    const fresh = [
      mapMessageRow(row({ id: incoming.id, sender: THEM, read_at: "y" }), ME),
      mine({ id: failed.id, read_at: "y" }),
      mine({ id: tomb.id, read_at: "y" }),
      mine({ id: "55555555-5555-4555-8555-555555555555", read_at: "y" }),
    ];
    const merged = mergeReceipts(list, fresh);
    expect(merged).toBe(list);
    expect(merged).toHaveLength(3);
  });
});

describe("ChatBubble ticks", () => {
  const render = (status: string, from: "me" | "them" = "me") => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <ChatBubble message={{ ...mapMessageRow(row(), ME), from, status }} />,
      );
    });
    return r;
  };
  const labels = (r: TestRenderer.ReactTestRenderer) =>
    r.root.findAll((n) => typeof n.props.accessibilityLabel === "string").map((n) => n.props.accessibilityLabel);

  it("labels sent, delivered and read", () => {
    expect(labels(render("sent"))).toContain("Sent");
    expect(labels(render("delivered"))).toContain("Delivered");
    expect(labels(render("read"))).toContain("Read");
  });

  it("shows no tick on failed or incoming messages", () => {
    expect(labels(render("failed"))).not.toContain("Sent");
    expect(labels(render("read", "them"))).toEqual([]);
  });
});
