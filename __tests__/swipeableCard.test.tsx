import React from "react";
import { PanResponder, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockLightColors = require("../mobile/src/constants/theme").LightColors;
jest.mock("../mobile/src/context/ThemeContext", () => ({
  useTheme: () => ({ colors: mockLightColors, isDark: false }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  SwipeableCard,
  resolveSwipeDirection,
} = require("../mobile/src/components/discovery/SwipeableCard");

type Handle = { swipe: (a: "like" | "pass" | "priority") => boolean };

let panConfig: any;
let tree: TestRenderer.ReactTestRenderer | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  panConfig = undefined;
  jest.spyOn(PanResponder, "create").mockImplementation(((cfg: any) => {
    panConfig = cfg;
    return { panHandlers: {} };
  }) as never);
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function render(props: { onSwipe: jest.Mock; disabled?: boolean }) {
  const ref = React.createRef<Handle>();
  await act(async () => {
    tree = TestRenderer.create(
      <SwipeableCard ref={ref} {...props}>
        <Text>profile</Text>
      </SwipeableCard>,
    );
  });
  return ref;
}

/** Runs the exit animation and the awaited onSwipe callback. */
const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(600);
    await Promise.resolve();
    await Promise.resolve();
  });

describe("resolveSwipeDirection", () => {
  it.each([
    [200, 0, "like"],
    [-200, 0, "pass"],
    [60, 0.9, "like"], // short but fast flick right
    [-60, -0.9, "pass"], // short but fast flick left
    [60, 0.1, null], // short and slow: springs back
    [-60, -0.1, null],
    [10, 2, null], // a fast twitch that barely moved is not a swipe
    [0, 0, null],
  ])("dx=%d vx=%d -> %s", (dx, vx, expected) => {
    expect(resolveSwipeDirection(dx as number, vx as number, 400)).toBe(expected);
  });
});

describe("SwipeableCard: drag gestures", () => {
  it("only claims clear horizontal drags, never taps, vertical drags or while disabled", async () => {
    await render({ onSwipe: jest.fn() });
    const claim = panConfig.onMoveShouldSetPanResponder;
    expect(claim({}, { dx: 30, dy: 2 })).toBe(true);
    expect(claim({}, { dx: -30, dy: 2 })).toBe(true);
    expect(claim({}, { dx: 4, dy: 0 })).toBe(false); // a tap
    expect(claim({}, { dx: 30, dy: 60 })).toBe(false); // mostly vertical

    await act(async () => {
      tree!.update(
        <SwipeableCard onSwipe={jest.fn()} disabled>
          <Text>profile</Text>
        </SwipeableCard>,
      );
    });
    expect(panConfig.onMoveShouldSetPanResponder({}, { dx: 80, dy: 0 })).toBe(false);
  });

  it("a long drag right is a like and a long drag left is a pass", async () => {
    const onSwipe = jest.fn();
    await render({ onSwipe });
    await act(async () => panConfig.onPanResponderRelease({}, { dx: 300, dy: 0, vx: 0 }));
    await settle();
    expect(onSwipe).toHaveBeenCalledWith("like");
    await act(async () => tree!.unmount());

    const onSwipe2 = jest.fn();
    await render({ onSwipe: onSwipe2 });
    await act(async () => panConfig.onPanResponderRelease({}, { dx: -300, dy: 0, vx: 0 }));
    await settle();
    expect(onSwipe2).toHaveBeenCalledWith("pass");
  });

  it("a short, slow drag springs back without swiping and the card stays usable", async () => {
    const onSwipe = jest.fn();
    const ref = await render({ onSwipe });
    await act(async () => panConfig.onPanResponderRelease({}, { dx: 40, dy: 0, vx: 0.05 }));
    await settle();
    expect(onSwipe).not.toHaveBeenCalled();
    expect(ref.current!.swipe("like")).toBe(true);
  });

  it("springs back when the system takes the gesture away", async () => {
    const onSwipe = jest.fn();
    await render({ onSwipe });
    await act(async () => panConfig.onPanResponderTerminate());
    await settle();
    expect(onSwipe).not.toHaveBeenCalled();
  });
});

describe("SwipeableCard: button-driven swipes", () => {
  it.each(["like", "pass", "priority"] as const)("swipe(%s) animates away, then reports once", async (action) => {
    const onSwipe = jest.fn();
    const ref = await render({ onSwipe });
    expect(ref.current!.swipe(action)).toBe(true);
    expect(onSwipe).not.toHaveBeenCalled(); // not before the card has left
    await settle();
    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(onSwipe).toHaveBeenCalledWith(action);
  });

  it("ignores a second swipe while the first is in flight", async () => {
    const onSwipe = jest.fn(() => new Promise<void>(() => undefined)); // never resolves
    const ref = await render({ onSwipe });
    expect(ref.current!.swipe("like")).toBe(true);
    expect(ref.current!.swipe("pass")).toBe(false);
    await settle();
    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(ref.current!.swipe("pass")).toBe(false);
  });

  it("does nothing while disabled", async () => {
    const onSwipe = jest.fn();
    const ref = await render({ onSwipe, disabled: true });
    expect(ref.current!.swipe("like")).toBe(false);
    await settle();
    expect(onSwipe).not.toHaveBeenCalled();
  });

  it("brings the card back, never stranded off-screen, when the caller does not replace it", async () => {
    const onSwipe = jest.fn().mockResolvedValue(undefined); // resolves but the card stays mounted
    const ref = await render({ onSwipe });
    expect(ref.current!.swipe("like")).toBe(true);
    await settle();
    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(ref.current!.swipe("like")).toBe(true); // usable again
  });

  it("survives a rejecting handler", async () => {
    const onSwipe = jest.fn().mockRejectedValue(new Error("network"));
    const ref = await render({ onSwipe });
    expect(ref.current!.swipe("like")).toBe(true);
    await settle();
    expect(ref.current!.swipe("like")).toBe(true);
  });

  it("does not report a swipe if the card is removed mid-animation", async () => {
    const onSwipe = jest.fn();
    const ref = await render({ onSwipe });
    ref.current!.swipe("like");
    await act(async () => tree!.unmount());
    tree = undefined;
    await act(async () => {
      jest.advanceTimersByTime(600);
      await Promise.resolve();
    });
    expect(onSwipe).not.toHaveBeenCalled();
  });
});
