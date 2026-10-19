import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockPlay = jest.fn(async () => ({ success: true }));
const mockStop = jest.fn(async () => undefined);
const mockPause = jest.fn(async () => undefined);

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
  getAudioPlayerAdapter: () => ({ playAsync: mockPlay, stopAsync: mockStop, pauseAsync: mockPause }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ChatBubble } = require("../mobile/src/components/chat/ChatBubble");

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  matchId: "f6c60000-0000-4000-8000-000000000001",
  sender: "aaaaaaaa-0000-4000-8000-000000000001",
  from: "me" as const,
  text: "original text",
  at: Date.now(),
  status: "sent" as const,
  messageType: "text" as const,
};

const render = (props: Record<string, unknown>) => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<ChatBubble {...(props as any)} />);
  });
  return r;
};
const texts = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).map((n) => React.Children.toArray(n.props.children).join(""));

beforeEach(() => jest.clearAllMocks());

describe("Phase 3B: ChatBubble tombstone and long press", () => {
  it("renders 'You deleted this message' for my tombstone and 'This message was deleted' for theirs", () => {
    const mine = render({ message: { ...base, text: "", deletedAt: "2026-10-20T01:00:00Z" } });
    expect(texts(mine).join("|")).toContain("You deleted this message");

    const theirs = render({ message: { ...base, from: "them", text: "", deletedAt: "2026-10-20T01:00:00Z" } });
    expect(texts(theirs).join("|")).toContain("This message was deleted");
  });

  it("never renders content, image or voice player for a tombstone, even if stale data is still attached", () => {
    const r = render({
      message: {
        ...base,
        text: "original text",
        image: "https://signed/img.jpg",
        audio: "https://signed/a.m4a",
        messageType: "voice",
        deletedAt: "2026-10-20T01:00:00Z",
      },
    });
    expect(texts(r).join("|")).not.toContain("original text");
    expect(r.root.findAll((n) => n.props?.source?.uri === "https://signed/img.jpg")).toHaveLength(0);
    expect(r.root.findAll((n) => typeof n.props?.onPress === "function" && n.props.activeOpacity === 0.8)).toHaveLength(0);
    expect(r.root.findAll((n) => n.props?.testID === `message-tombstone-${base.id}`).length).toBeGreaterThan(0);
  });

  it("still renders a normal message unchanged", () => {
    const r = render({ message: base });
    expect(texts(r).join("|")).toContain("original text");
    expect(texts(r).join("|")).not.toContain("deleted");
  });

  it("calls onLongPress with the message and is inert when no handler is given", () => {
    const onLongPress = jest.fn();
    const withHandler = render({ message: base, onLongPress });
    const pressable = withHandler.root.find((n) => n.props?.testID === `message-bubble-${base.id}` && typeof n.props.onLongPress === "function");
    act(() => pressable.props.onLongPress());
    expect(onLongPress).toHaveBeenCalledWith(base);

    const without = render({ message: base });
    expect(without.root.findAll((n) => n.props?.testID === `message-bubble-${base.id}` && typeof n.props.onLongPress === "function")).toHaveLength(0);
  });

  it("stops a voice note that is playing the moment it is deleted for everyone", async () => {
    const voice = { ...base, text: "Voice message", audio: "https://signed/a.m4a", audioDurationSec: 8, messageType: "voice" as const };
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<ChatBubble message={voice} />);
    });
    const play = r.root.find((n) => typeof n.props?.onPress === "function" && n.props.activeOpacity === 0.8);
    await act(async () => {
      await play.props.onPress();
    });
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(mockStop).not.toHaveBeenCalled();

    await act(async () => {
      r.update(<ChatBubble message={{ ...voice, text: "", audio: undefined, deletedAt: "2026-10-20T01:00:00Z" }} />);
    });
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("does not touch the player when a bubble that was not playing gets deleted", async () => {
    const voice = { ...base, text: "Voice message", audio: "https://signed/a.m4a", messageType: "voice" as const };
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<ChatBubble message={voice} />);
    });
    await act(async () => {
      r.update(<ChatBubble message={{ ...voice, text: "", audio: undefined, deletedAt: "2026-10-20T01:00:00Z" }} />);
    });
    expect(mockStop).not.toHaveBeenCalled();
  });
});
