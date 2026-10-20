import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockLightColors = require("../mobile/src/constants/theme").LightColors;
const mockIcons: string[] = [];

jest.mock("../mobile/src/context/ThemeContext", () => ({
  useTheme: () => ({ colors: mockLightColors, isDark: false }),
}));
jest.mock("lucide-react-native", () =>
  new Proxy({ __esModule: true }, {
    get: (t: any, k: string) => (k in t ? t[k] : () => { mockIcons.push(k); return null; }),
  }),
);
jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: any) => require("react").createElement("View", null, children),
}));
jest.mock("../mobile/src/components/profile/ProfilePhoto", () => ({ ProfilePhoto: () => null }));
jest.mock("../mobile/src/components/ui/AvatarPlaceholder", () => ({ AvatarPlaceholder: () => null }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DiscoveryCard } = require("../mobile/src/components/discovery/DiscoveryCard");

const profile: any = { id: "p1", name: "Asha", age: 27, photos: [], interests: [], city: "Pune" };

async function render(onPressDetails?: () => void) {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<DiscoveryCard profile={profile} onPressDetails={onPressDetails} />);
  });
  return tree;
}
const button = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props?.testID === "discovery-details-button" && typeof n.props?.onPress === "function");

describe("DiscoveryCard details arrow", () => {
  beforeEach(() => (mockIcons.length = 0));

  it("shows an up-arrow button that opens the details, with an accessible label", async () => {
    const onPressDetails = jest.fn();
    const tree = await render(onPressDetails);
    const [btn] = button(tree);
    expect(btn!.props.accessibilityLabel).toBe("View profile details");
    expect(btn!.props.accessibilityRole).toBe("button");
    expect(mockIcons).toContain("ChevronUp");
    expect(mockIcons).not.toContain("Info");
    await act(async () => btn!.props.onPress());
    expect(onPressDetails).toHaveBeenCalledTimes(1);
  });

  it("has no arrow when there is nothing to open", async () => {
    const tree = await render(undefined);
    expect(button(tree)).toHaveLength(0);
  });
});
