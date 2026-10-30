import React from "react";
import { PanResponder } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockLightColors = require("../mobile/src/constants/theme").LightColors;
const mockPush = jest.fn();
const mockSwipeCard = jest.fn();
const mockAlert = jest.fn();
const mockMilo: any = {};

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: () => undefined,
}));
jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t: any, k: string) => (k in t ? t[k] : () => null) }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => require("react").createElement("View", null, children),
}));
jest.mock("../mobile/src/context/ThemeContext", () => ({
  useTheme: () => ({ colors: mockLightColors, isDark: false }),
}));
jest.mock("../mobile/src/context/MiloContext", () => ({ useMilo: () => mockMilo }));
jest.mock("../mobile/src/components/discovery/FilterModal", () => ({ FilterModal: () => null }));
jest.mock("../mobile/src/components/discovery/DiscoveryCard", () => ({
  DiscoveryCard: ({ profile, onPressDetails }: any) =>
    require("react").createElement(
      "View",
      { testID: "card" },
      require("react").createElement("View", { testID: "discovery-details-button", onPress: onPressDetails, profileId: profile.id }),
    ),
}));
jest.mock("../mobile/src/services/subscription", () => ({ hasEntitlement: () => true }));
// Sponsored cards (2026-10-30): none running in these tests.
jest.mock("../mobile/src/services/adminContent", () => ({ AD_EVERY_SWIPES: 7, fetchDiscoverAds: () => Promise.resolve([]) }));
jest.mock("../mobile/src/components/discovery/AdCard", () => ({ AdCard: () => null }));
jest.mock("../mobile/src/services/location", () => ({ isLocationSharingEnabled: () => Promise.resolve(false) }));
jest.mock("../mobile/src/services/locationSelection", () => ({ loadLocationSelection: () => Promise.resolve(null) }));
jest.mock("../mobile/src/services/consent", () => ({ ensureConsent: jest.fn(), setConsent: jest.fn() }));
jest.mock("../mobile/src/utils/alert", () => ({ Alert: { alert: (...a: any[]) => mockAlert(...a) } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DiscoverScreen = require("../mobile/app/(tabs)/discover").default as React.ComponentType;

let panConfig: any;
let tree: TestRenderer.ReactTestRenderer | undefined;

const PROFILE = { id: "p1", name: "Asha", age: 27, photos: [], interests: [] };

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockClear();
  mockAlert.mockClear();
  mockSwipeCard.mockReset().mockResolvedValue({ success: true, isMatch: false, likesRemaining: 10 });
  Object.assign(mockMilo, {
    currentProfile: PROFILE,
    deck: [PROFILE],
    likesRemaining: 10,
    dailyLikeLimit: 50,
    lastPassedId: null,
    filters: { interests: [] },
    loadingDeck: false,
    isBoosting: false,
    boostTimeRemaining: 0,
    subscription: null,
    swipeCard: mockSwipeCard,
    undoPass: jest.fn(),
    triggerBoost: jest.fn(),
    setFilters: jest.fn(),
    refreshDeck: jest.fn(),
  });
  jest.spyOn(PanResponder, "create").mockImplementation(((cfg: any) => {
    panConfig = cfg;
    return { panHandlers: {} };
  }) as never);
});

afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function render() {
  await act(async () => {
    tree = TestRenderer.create(<DiscoverScreen />);
  });
}
const byTestId = (id: string) =>
  tree!.root.findAll((n) => n.props?.testID === id && typeof n.props?.onPress === "function")[0]!;
const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(600);
    await Promise.resolve();
    await Promise.resolve();
  });
const press = (id: string) => act(async () => byTestId(id).props.onPress());

describe("Discover: swipe gestures and action buttons", () => {
  it.each([
    ["discover-like-button", "like"],
    ["discover-pass-button", "pass"],
    ["discover-priority-button", "priority"],
  ])("%s animates the card away and then swipes '%s'", async (testId, direction) => {
    await render();
    await press(testId);
    expect(mockSwipeCard).not.toHaveBeenCalled(); // the card is still on its way out
    await settle();
    expect(mockSwipeCard).toHaveBeenCalledTimes(1);
    expect(mockSwipeCard).toHaveBeenCalledWith(direction);
  });

  it("dragging the card right likes and dragging it left passes", async () => {
    await render();
    await act(async () => panConfig.onPanResponderRelease({}, { dx: 320, dy: 0, vx: 0 }));
    await settle();
    expect(mockSwipeCard).toHaveBeenLastCalledWith("like");
    await act(async () => tree!.unmount());

    mockSwipeCard.mockClear();
    await render();
    await act(async () => panConfig.onPanResponderRelease({}, { dx: -320, dy: 0, vx: 0 }));
    await settle();
    expect(mockSwipeCard).toHaveBeenLastCalledWith("pass");
  });

  it("a short drag does not swipe", async () => {
    await render();
    await act(async () => panConfig.onPanResponderRelease({}, { dx: 30, dy: 0, vx: 0.05 }));
    await settle();
    expect(mockSwipeCard).not.toHaveBeenCalled();
  });

  it("a match opens the match screen for the person who was just liked", async () => {
    mockSwipeCard.mockResolvedValue({ success: true, isMatch: true, likesRemaining: 9 });
    await render();
    await press("discover-like-button");
    await settle();
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/match/[id]", params: { id: "p1" } });
  });

  it("shows the out-of-likes message when the server refuses the like", async () => {
    mockSwipeCard.mockResolvedValue({ success: false, isMatch: false, likesRemaining: 0, error: "daily_like_limit_reached" });
    await render();
    await press("discover-like-button");
    await settle();
    expect(mockAlert).toHaveBeenCalledWith("Out of likes", expect.stringContaining("50"));
  });

  it("a second tap while the first swipe is in flight is ignored", async () => {
    mockSwipeCard.mockReturnValue(new Promise(() => undefined));
    await render();
    await press("discover-like-button");
    await press("discover-pass-button");
    await settle();
    expect(mockSwipeCard).toHaveBeenCalledTimes(1);
    expect(mockSwipeCard).toHaveBeenCalledWith("like");
  });

  it("never strands the card off-screen if the deck did not advance", async () => {
    await render();
    await press("discover-like-button");
    await settle();
    await press("discover-like-button"); // same profile is still current: the card came back
    await settle();
    expect(mockSwipeCard).toHaveBeenCalledTimes(2);
  });

  it("the details arrow opens the profile of the card on screen", async () => {
    await render();
    await press("discovery-details-button");
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/profile/[id]", params: { id: "p1" } });
  });

  it("shows no card, buttons or swipe handling when the deck is empty", async () => {
    mockMilo.currentProfile = null;
    mockMilo.deck = [];
    await render();
    expect(tree!.root.findAll((n) => n.props?.testID === "swipeable-card")).toHaveLength(0);
    expect(tree!.root.findAll((n) => n.props?.testID === "discover-like-button")).toHaveLength(0);
  });
});
