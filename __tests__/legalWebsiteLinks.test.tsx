import React from "react";
import { Alert } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import {
  LEGAL_WEBSITE_BASE_URL,
  LEGAL_WEBSITE_PATHS,
  legalWebsiteUrl,
} from "../mobile/src/constants/legalLinks";
import { OPERATOR_DETAILS } from "../mobile/src/constants/operatorDetails";

const mockPush = jest.fn();
const mockOpenBrowser = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowser(...args),
}));
jest.mock("../mobile/src/context/ThemeContext", () => ({
  useTheme: () => ({ colors: require("../mobile/src/constants/theme").LightColors, isDark: false }),
}));
jest.mock("lucide-react-native", () => ({
  ArrowLeft: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => require("react").createElement("View", null, children),
}));
jest.mock("../mobile/src/services/consent", () => ({
  fetchMyConsents: async () => ({}),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LegalScreen = require("../mobile/app/legal/index").default as React.ComponentType;

const instText = (inst: TestRenderer.ReactTestInstance): string =>
  inst.children.map((c) => (typeof c === "string" ? c : instText(c))).join("");
// A touchable renders as a composite plus an inner host node carrying the same props; keep only the outermost one.
const byRole = (tree: TestRenderer.ReactTestRenderer, role: string) =>
  tree.root.findAll(
    (n) =>
      n.props?.accessibilityRole === role &&
      typeof n.props?.onPress === "function" &&
      n.parent?.props?.onPress !== n.props.onPress,
  );

async function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<LegalScreen />);
  });
  return tree;
}

const linkByLabel = (tree: TestRenderer.ReactTestRenderer, label: string) => {
  const found = byRole(tree, "link").find((l) => instText(l) === label);
  if (!found) throw new Error(`no link labelled "${label}"`);
  return found;
};

beforeEach(() => {
  mockPush.mockReset();
  mockOpenBrowser.mockReset();
  mockOpenBrowser.mockResolvedValue({ type: "opened" });
});

describe("legal website URL configuration", () => {
  it("uses the official website base URL over https, without a trailing slash", () => {
    expect(LEGAL_WEBSITE_BASE_URL).toBe("https://chahatlegal.netlify.app");
    expect(LEGAL_WEBSITE_BASE_URL.startsWith("https://")).toBe(true);
    expect(LEGAL_WEBSITE_BASE_URL.endsWith("/")).toBe(false);
  });

  it("builds the verified page URLs", () => {
    expect(legalWebsiteUrl("privacy")).toBe("https://chahatlegal.netlify.app/privacy-policy");
    expect(legalWebsiteUrl("terms")).toBe("https://chahatlegal.netlify.app/terms");
    expect(legalWebsiteUrl("communityGuidelines")).toBe("https://chahatlegal.netlify.app/community-guidelines");
    expect(legalWebsiteUrl("childSafety")).toBe("https://chahatlegal.netlify.app/child-safety");
    expect(legalWebsiteUrl("deleteAccount")).toBe("https://chahatlegal.netlify.app/delete-account");
    expect(legalWebsiteUrl("support")).toBe("https://chahatlegal.netlify.app/support");
  });

  it("every configured path is a single absolute path with no query, fragment or whitespace", () => {
    for (const p of Object.values(LEGAL_WEBSITE_PATHS)) {
      expect(p).toMatch(/^\/[a-z0-9-]+$/);
    }
  });

  it("the child-safety page is no longer an unconfirmed placeholder in the operator details", () => {
    expect(Object.keys(OPERATOR_DETAILS)).not.toContain("childSafetyStandardsUrl");
  });
});

describe("Legal & Privacy screen: official website links", () => {
  // The first full render of the legal screen can take > 5 s on a cold Windows Jest run (seen locally:
  // 23 s suite, first case timed out). Only the time budget changes; every assertion is unchanged.
  jest.setTimeout(30_000);
  const cases: Array<[string, string]> = [
    ["Privacy Policy (website)", "https://chahatlegal.netlify.app/privacy-policy"],
    ["Terms of Service (website)", "https://chahatlegal.netlify.app/terms"],
    ["Community Guidelines", "https://chahatlegal.netlify.app/community-guidelines"],
    ["Child Safety Standards", "https://chahatlegal.netlify.app/child-safety"],
    ["Delete your account (website)", "https://chahatlegal.netlify.app/delete-account"],
    ["Support", "https://chahatlegal.netlify.app/support"],
  ];

  it.each(cases)("%s opens %s in the in-app browser", async (label, url) => {
    const tree = await render();
    await act(async () => {
      linkByLabel(tree, label).props.onPress();
    });
    expect(mockOpenBrowser).toHaveBeenCalledTimes(1);
    expect(mockOpenBrowser).toHaveBeenCalledWith(url);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("the child-safety link in the community section opens the same verified page", async () => {
    const tree = await render();
    const buttons = byRole(tree, "button");
    const community = buttons.find((b) => instText(b).includes("Community guidelines, reporting and child safety"));
    expect(community).toBeDefined();
    await act(async () => {
      community!.props.onPress();
    });
    await act(async () => {
      linkByLabel(tree, "Child Safety Standards (website)").props.onPress();
    });
    expect(mockOpenBrowser).toHaveBeenCalledWith("https://chahatlegal.netlify.app/child-safety");
  });

  it("keeps the in-app Terms and Privacy screens as the first two links", async () => {
    const tree = await render();
    const links = byRole(tree, "link");
    expect(instText(links[0])).toBe("Terms of Service");
    expect(instText(links[1])).toBe("Privacy Policy");
    await act(async () => {
      links[0].props.onPress();
      links[1].props.onPress();
    });
    expect(mockPush).toHaveBeenNthCalledWith(1, "/legal/terms");
    expect(mockPush).toHaveBeenNthCalledWith(2, "/legal/privacy");
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it("shows a friendly message instead of crashing when the browser cannot open", async () => {
    mockOpenBrowser.mockRejectedValue(new Error("no browser"));
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const tree = await render();
    await act(async () => {
      linkByLabel(tree, "Support").props.onPress();
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(String(alertSpy.mock.calls[0][1])).toContain("https://chahatlegal.netlify.app/support");
    alertSpy.mockRestore();
  });

  it("opening the delete-account page does not start a deletion", async () => {
    const tree = await render();
    await act(async () => {
      linkByLabel(tree, "Delete your account (website)").props.onPress();
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockOpenBrowser).toHaveBeenCalledTimes(1);
  });
});
