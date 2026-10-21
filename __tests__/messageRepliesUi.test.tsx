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
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const ORIG = "11111111-1111-4111-8111-111111111111";
const REPLY = "22222222-2222-4222-8222-222222222222";

const replyRow = (over: Record<string, unknown> = {}) => ({
  id: REPLY,
  match_id: "f6c60000-0000-4000-8000-000000000001",
  sender: ME,
  body: "my answer",
  message_type: "text",
  created_at: "2026-10-22T10:00:00Z",
  read_at: null,
  delivered_at: null,
  deleted_at: null,
  reply_to_id: ORIG,
  reply_sender: THEM,
  reply_body: "what are you doing tonight?",
  reply_kind: "text",
  reply_unavailable: false,
  ...over,
});

const render = (el: React.ReactElement) => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(el);
  });
  return r;
};
const text = (r: TestRenderer.ReactTestRenderer) => JSON.stringify(r.toJSON());
const quote = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByProps({ testID: `message-reply-quote-${REPLY}` });

describe("ChatBubble quoted reply", () => {
  it("shows the author and the quoted text above the reply", () => {
    const r = render(<ChatBubble message={mapMessageRow(replyRow(), ME)} partnerName="Ananya" />);
    expect(quote(r).length).toBeGreaterThan(0);
    expect(text(r)).toContain("Ananya");
    expect(text(r)).toContain("what are you doing tonight?");
    expect(text(r)).toContain("my answer");
  });

  it("quotes my own message as \"You\"", () => {
    const r = render(<ChatBubble message={mapMessageRow(replyRow({ reply_sender: ME }), ME)} partnerName="Ananya" />);
    expect(text(r)).toContain('"You"');
  });

  it("a plain message has no quote", () => {
    const r = render(<ChatBubble message={mapMessageRow(replyRow({ reply_to_id: null }), ME)} partnerName="Ananya" />);
    expect(quote(r)).toHaveLength(0);
  });

  it("photo and voice originals show a label instead of text", () => {
    const photo = render(<ChatBubble message={mapMessageRow(replyRow({ reply_kind: "image", reply_body: null }), ME)} partnerName="Ananya" />);
    expect(text(photo)).toContain("Photo");
    const voice = render(<ChatBubble message={mapMessageRow(replyRow({ reply_kind: "voice", reply_body: null }), ME)} partnerName="Ananya" />);
    expect(text(voice)).toContain("Voice message");
  });

  it("tapping the quote reports the original's id", () => {
    const onReplyPress = jest.fn();
    const r = render(<ChatBubble message={mapMessageRow(replyRow(), ME)} partnerName="Ananya" onReplyPress={onReplyPress} />);
    const q = r.root.findAll((n) => n.props.testID === `message-reply-quote-${REPLY}` && typeof n.props.onPress === "function")[0]!;
    act(() => q.props.onPress());
    expect(onReplyPress).toHaveBeenCalledWith(ORIG);
  });

  it("an unavailable original shows a placeholder, no content, and cannot be tapped", () => {
    const onReplyPress = jest.fn();
    const r = render(
      <ChatBubble
        message={mapMessageRow(replyRow({ reply_unavailable: true, reply_sender: null, reply_body: null }), ME)}
        partnerName="Ananya"
        onReplyPress={onReplyPress}
      />,
    );
    expect(text(r)).toContain("Original message unavailable");
    expect(text(r)).not.toContain("what are you doing tonight?");
    const tappable = r.root.findAll((n) => n.props.testID === `message-reply-quote-${REPLY}` && typeof n.props.onPress === "function");
    expect(tappable).toHaveLength(0);
  });

  it("the live deletion state hides the quote content even when the loaded preview still has it", () => {
    const r = render(<ChatBubble message={mapMessageRow(replyRow(), ME)} partnerName="Ananya" replyUnavailable />);
    expect(text(r)).toContain("Original message unavailable");
    expect(text(r)).not.toContain("what are you doing tonight?");
  });

  it("a reply that was itself deleted for everyone shows only the tombstone", () => {
    const r = render(<ChatBubble message={mapMessageRow(replyRow({ body: "", deleted_at: "2026-10-22T10:05:00Z" }), ME)} partnerName="Ananya" />);
    expect(quote(r)).toHaveLength(0);
    expect(text(r)).not.toContain("what are you doing tonight?");
  });
});

describe("MessageActionSheet reply option", () => {
  const props = { visible: true, canDeleteForEveryone: false, onDeleteForMe: jest.fn(), onDeleteForEveryone: jest.fn(), onClose: jest.fn() };

  it("offers Reply and reports the tap", () => {
    const onReply = jest.fn();
    const r = render(<MessageActionSheet {...props} canReply onReply={onReply} />);
    const option = r.root.findAll((n) => n.props.testID === "message-action-reply" && typeof n.props.onPress === "function")[0]!;
    act(() => option.props.onPress());
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it("hides Reply when it is not allowed (deleted message) and keeps the delete options", () => {
    const r = render(<MessageActionSheet {...props} canReply={false} onReply={jest.fn()} />);
    expect(r.root.findAllByProps({ testID: "message-action-reply" })).toHaveLength(0);
    expect(r.root.findAllByProps({ testID: "message-action-delete-for-me" }).length).toBeGreaterThan(0);
  });
});
