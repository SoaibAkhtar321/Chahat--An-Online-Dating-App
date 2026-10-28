import React from "react";
import * as fs from "fs";
import * as path from "path";
import TestRenderer, { act } from "react-test-renderer";
import { LEGAL_DOCUMENT_VERSIONS } from "../mobile/src/constants/legalVersions";
import {
  OPERATOR_DETAILS,
  isOperatorPlaceholder,
  unresolvedOperatorDetails,
} from "../mobile/src/constants/operatorDetails";
import { LEGAL_ACCEPT_PATH, legalGateRedirect } from "../mobile/src/utils/legalGate";

const mockPush = jest.fn();
const mockFetchMyConsents = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
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
  fetchMyConsents: (...args: any[]) => mockFetchMyConsents(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LegalScreen = require("../mobile/app/legal/index").default as React.ComponentType;

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const consentState = (purpose: string, decision: "granted" | "withdrawn" | null) => ({
  purpose,
  decision,
  noticeVersion: decision ? "2026-10-18" : null,
  currentNoticeVersion: "2026-10-18",
});

async function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<LegalScreen />);
  });
  return tree;
}
const text = (tree: TestRenderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());
// All visible strings joined together, so a sentence built from several JSX children can be searched as a phrase.
const collect = (node: any): string =>
  node == null ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(collect).join("") : collect(node.children);
const flat = (tree: TestRenderer.ReactTestRenderer) => collect(tree.toJSON());
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
const sectionButtons = (tree: TestRenderer.ReactTestRenderer) => byRole(tree, "button");
const links = (tree: TestRenderer.ReactTestRenderer) => byRole(tree, "link");

async function open(tree: TestRenderer.ReactTestRenderer, index: number) {
  await act(async () => {
    sectionButtons(tree)[index].props.onPress();
  });
}

beforeEach(() => {
  mockPush.mockReset();
  mockFetchMyConsents.mockReset();
  mockFetchMyConsents.mockResolvedValue({
    location_discovery: consentState("location_discovery", "granted"),
    push_notifications: consentState("push_notifications", null),
  });
});

describe("Legal & Privacy screen", () => {
  it("shows the six required sections, with only the documents section open at first", async () => {
    const tree = await render();
    const out = text(tree);
    for (const title of [
      "Terms & Conditions and Privacy Policy",
      "Your data, service providers and choices",
      "Retention, deletion and privacy requests",
      "Community guidelines, reporting and child safety",
      "Subscriptions, cancellation and refunds",
      "Support, grievances and contact",
    ]) {
      expect(out).toContain(title);
    }
    expect(sectionButtons(tree)).toHaveLength(6);
    expect(flat(tree)).toContain(`Terms ${LEGAL_DOCUMENT_VERSIONS.terms}`);
    expect(out).not.toContain("Grievance officer");
  });

  it("expands a section when tapped and collapses it when tapped again", async () => {
    const tree = await render();
    await open(tree, 5);
    expect(text(tree)).toContain("Grievance officer");
    await open(tree, 5);
    expect(text(tree)).not.toContain("Grievance officer");
  });

  it("links to the existing Terms and Privacy screens and to Settings and the Safety Centre", async () => {
    const tree = await render();
    links(tree)[0].props.onPress();
    links(tree)[1].props.onPress();
    expect(mockPush).toHaveBeenNthCalledWith(1, "/legal/terms");
    expect(mockPush).toHaveBeenNthCalledWith(2, "/legal/privacy");

    await open(tree, 1);
    const settingsLink = links(tree).find((l) => instText(l).includes("Change these choices"));
    settingsLink!.props.onPress();
    expect(mockPush).toHaveBeenLastCalledWith("/settings");

    await open(tree, 3);
    const safety = links(tree).find((l) => instText(l).includes("Safety Centre"));
    safety!.props.onPress();
    expect(mockPush).toHaveBeenLastCalledWith("/safety");
  });

  it("reports the server-side choice for location and push, never a guess", async () => {
    const tree = await render();
    await open(tree, 1);
    const out = text(tree);
    expect(out).toContain('"On"');
    expect(out).toContain('"Not chosen"');
  });

  it("shows Off after a withdrawal and Unavailable when the choices cannot be loaded", async () => {
    mockFetchMyConsents.mockResolvedValue({
      location_discovery: consentState("location_discovery", "withdrawn"),
      push_notifications: consentState("push_notifications", "withdrawn"),
    });
    let tree = await render();
    await open(tree, 1);
    expect(text(tree)).toContain('"Off"');

    mockFetchMyConsents.mockRejectedValue(new Error("offline"));
    tree = await render();
    await open(tree, 1);
    expect(text(tree)).toContain('"Unavailable"');
  });

  it("marks every unconfirmed operator detail as not yet provided", async () => {
    const tree = await render();
    let all = "";
    for (let i = 1; i < 6; i++) {
      await open(tree, i);
      all += text(tree);
    }
    expect(all).toContain("Not yet provided");
    for (const value of Object.values(OPERATOR_DETAILS)) {
      if (isOperatorPlaceholder(value)) expect(all).toContain(value);
    }
  });

  it("states how Google Play cancellation and refunds relate, without inventing a refund policy", async () => {
    const tree = await render();
    await open(tree, 4);
    const out = text(tree);
    // Prepaid plans (2026-10-29): no renewals, nothing to cancel.
    expect(out).toContain("They do not renew automatically");
    expect(out).toContain("Refunds follow Google Play's rules");
    expect(out).toContain(OPERATOR_DETAILS.refundPolicy);
  });
});

describe("operator details", () => {
  it("every detail is a bracketed placeholder until someone confirms it", () => {
    expect(unresolvedOperatorDetails().sort()).toEqual(Object.keys(OPERATOR_DETAILS).sort());
  });

  it("recognises a confirmed value as not a placeholder", () => {
    expect(isOperatorPlaceholder("[TO BE CONFIRMED]")).toBe(true);
    expect(isOperatorPlaceholder("Example Pvt Ltd")).toBe(false);
    expect(unresolvedOperatorDetails({ a: "[x]", b: "real value" })).toEqual(["a"]);
  });
});

describe("Step 4 keeps Steps 1-3 intact", () => {
  it("the screen only reads choices; it never records, grants or withdraws consent", () => {
    const src = read("mobile/app/legal/index.tsx");
    expect(src).toMatch(/fetchMyConsents/);
    expect(src).not.toMatch(/setConsent|ensureConsent|accept_current_legal_documents|acceptCurrentLegalDocuments/);
  });

  it("Settings links to the consolidated screen and still manages consent itself", () => {
    const src = read("mobile/app/settings/index.tsx");
    expect(src).toMatch(/router\.push\("\/legal"\)/);
    expect(src).toMatch(/setConsent\("location_discovery", "withdrawn"\)/);
    expect(src).toMatch(/setConsent\("push_notifications", "withdrawn"\)/);
  });

  it("the route is registered, and the version-aware gate still blocks it until Terms are accepted", () => {
    expect(read("mobile/app/_layout.tsx")).toMatch(/name="legal\/index"/);
    expect(legalGateRedirect({ isLoggedIn: true, legalStatus: "required", pathname: "/legal" })).toBe(
      LEGAL_ACCEPT_PATH,
    );
    for (const p of ["/legal/accept", "/legal/terms", "/legal/privacy"]) {
      expect(legalGateRedirect({ isLoggedIn: true, legalStatus: "required", pathname: p })).toBeNull();
    }
  });

  it("the signup checkbox is still present and unchecked by default", () => {
    const signup = read("mobile/app/(auth)/signup.tsx");
    expect(signup).toMatch(/LegalAcceptanceCheckbox/);
    expect(signup).toMatch(/useState\(false\)/);
  });

  it("uses theme tokens only (no hard-coded colours)", () => {
    expect(read("mobile/app/legal/index.tsx")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
