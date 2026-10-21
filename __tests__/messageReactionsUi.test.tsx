import React from "react";
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
const { MessageActionSheet } = require("../mobile/src/components/chat/MessageActionSheet");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mapMessageRow } = require("../mobile/src/utils/messageState");

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const MSG = "11111111-1111-4111-8111-111111111111";
const baseRow = {
  id: MSG,
  match_id: "f6c60000-0000-4000-8000-000000000001",
  sender: ME,
  body: "hi",
  created_at: "2026-10-21T10:00:00Z",
  read_at: null,
  delivered_at: null,
  deleted_at: null,
};

const render = (el: React.ReactElement) => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(el);
  });
  return r;
};

describe("ChatBubble reaction chips", () => {
  const chips = [
    { emoji: "👍", count: 2, mine: true },
    { emoji: "❤️", count: 1, mine: false },
  ];

  it("renders a chip per emoji, with a count only when more than one", () => {
    const r = render(<ChatBubble message={mapMessageRow(baseRow, ME)} reactions={chips} />);
    expect(r.root.findAllByProps({ testID: `message-reaction-chip-${MSG}-👍` }).length).toBeGreaterThan(0);
    expect(r.root.findAllByProps({ testID: `message-reaction-chip-${MSG}-❤️` }).length).toBeGreaterThan(0);
    const text = JSON.stringify(r.toJSON());
    expect(text).toContain('"2"');
    expect(text).not.toContain('"1"');
  });

  it("tapping a chip reports the message and emoji", () => {
    const onPress = jest.fn();
    const message = mapMessageRow(baseRow, ME);
    const r = render(<ChatBubble message={message} reactions={chips} onReactionPress={onPress} />);
    const chip = r.root.findAll((n) => n.props.testID === `message-reaction-chip-${MSG}-❤️` && typeof n.props.onPress === "function")[0]!;
    act(() => chip.props.onPress());
    expect(onPress).toHaveBeenCalledWith(message, "❤️");
  });

  it("shows no chips without reactions, and none on a message deleted for everyone", () => {
    expect(render(<ChatBubble message={mapMessageRow(baseRow, ME)} reactions={[]} />).root.findAllByProps({ testID: `message-reactions-${MSG}` })).toHaveLength(0);
    const deleted = mapMessageRow({ ...baseRow, body: "", deleted_at: "2026-10-21T10:05:00Z" }, ME);
    expect(render(<ChatBubble message={deleted} reactions={chips} />).root.findAllByProps({ testID: `message-reactions-${MSG}` })).toHaveLength(0);
  });
});

describe("MessageActionSheet reaction picker", () => {
  const props = { visible: true, canDeleteForEveryone: false, onDeleteForMe: jest.fn(), onDeleteForEveryone: jest.fn(), onClose: jest.fn() };

  it("offers the six reactions and reports the tapped one", () => {
    const onReact = jest.fn();
    const r = render(<MessageActionSheet {...props} canReact onReact={onReact} currentReaction="👍" />);
    expect(r.root.findAllByProps({ testID: "message-reaction-picker" }).length).toBeGreaterThan(0);
    const heart = r.root.findAll((n) => n.props.testID === "message-react-❤️" && typeof n.props.onPress === "function")[0]!;
    act(() => heart.props.onPress());
    expect(onReact).toHaveBeenCalledWith("❤️");
    const current = r.root.findAll((n) => n.props.testID === "message-react-👍" && typeof n.props.accessibilityLabel === "string")[0]!;
    expect(current.props.accessibilityLabel).toBe("Remove 👍 reaction");
  });

  it("hides the picker when reacting is not allowed (deleted message) and keeps the delete options", () => {
    const r = render(<MessageActionSheet {...props} canReact={false} onReact={jest.fn()} />);
    expect(r.root.findAllByProps({ testID: "message-reaction-picker" })).toHaveLength(0);
    expect(r.root.findAllByProps({ testID: "message-action-delete-for-me" }).length).toBeGreaterThan(0);
  });
});
