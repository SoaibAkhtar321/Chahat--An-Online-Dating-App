// Video call layout (2026-10-30): tap the small box to swap videos, drag it anywhere (snaps to a side), and it
// never covers the status bar or the call buttons.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 40, bottom: 20, left: 0, right: 0 }) }));

import {
  CallVideoStage,
  CONTROLS_CLEARANCE,
  SMALL_BOX,
  snapPosition,
  stageBounds,
} from "../mobile/src/components/call/CallVideoStage";

const { Text } = jest.requireActual("react-native");

function fakeSession() {
  const calls: string[] = [];
  return {
    calls,
    session: {
      video: {
        getState: () => ({}),
        subscribe: () => () => undefined,
        renderLocal: (overlay?: boolean) => {
          calls.push(`local:${overlay ? "small" : "large"}`);
          return <Text>{overlay ? "me-small" : "me-large"}</Text>;
        },
        renderRemote: (overlay?: boolean) => {
          calls.push(`remote:${overlay ? "small" : "large"}`);
          return <Text>{overlay ? "them-small" : "them-large"}</Text>;
        },
      },
    } as any,
  };
}

describe("small video box position", () => {
  const b = stageBounds(400, 800, { top: 40, bottom: 20 });
  it("stays below the status bar and above the call buttons", () => {
    expect(b.minY).toBe(52);
    expect(b.maxY).toBe(800 - 20 - CONTROLS_CLEARANCE - SMALL_BOX.height);
    expect(b.maxX).toBe(400 - SMALL_BOX.width - 12);
  });
  it("snaps to the nearest side and is clamped vertically", () => {
    expect(snapPosition(30, 5, b)).toEqual({ x: 12, y: b.minY });
    expect(snapPosition(300, 9999, b)).toEqual({ x: b.maxX, y: b.maxY });
  });
});

describe("tap to swap", () => {
  const texts = (r: TestRenderer.ReactTestRenderer) =>
    r.root.findAll((n) => typeof n.props.children === "string" && n.props.children.includes("-")).map((n) => n.props.children);
  it("other person large by default; a tap shows yourself large; another tap swaps back", () => {
    const { session } = fakeSession();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(<CallVideoStage session={session} />);
    });
    const stage = r.root.find((n) => n.props.testID === "call-video-stage" && typeof n.props.onLayout === "function");
    act(() => stage.props.onLayout({ nativeEvent: { layout: { width: 400, height: 800 } } }));
    expect(texts(r)).toEqual(expect.arrayContaining(["them-large", "me-small"]));

    const ev = { nativeEvent: { touches: [], changedTouches: [] }, touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 } };
    const tap = () => {
      const box = r.root.find((n) => n.props.testID === "call-video-small" && typeof n.props.onResponderRelease === "function");
      act(() => box.props.onResponderRelease(ev));
    };
    tap();
    expect(texts(r)).toEqual(expect.arrayContaining(["me-large", "them-small"]));
    tap();
    expect(texts(r)).toEqual(expect.arrayContaining(["them-large", "me-small"]));
  });
});
