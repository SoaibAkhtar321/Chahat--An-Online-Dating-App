import React from "react";
import * as fs from "fs";
import * as path from "path";
import TestRenderer, { act } from "react-test-renderer";
import { SUPPORT_CONTACT, supportMailtoUrl } from "../mobile/src/constants/supportContact";

const mockPush = jest.fn();
const mockOpenURL = jest.fn();
const mockAlert = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock("../mobile/src/context/ThemeContext", () => ({
  useTheme: () => ({ colors: require("../mobile/src/constants/theme").LightColors, isDark: false }),
}));
jest.mock("lucide-react-native", () => ({ ArrowLeft: () => null, ChevronRight: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => require("react").createElement("View", null, children),
}));
jest.mock("../mobile/src/utils/alert", () => ({ Alert: { alert: (...a: any[]) => mockAlert(...a) } }));
jest.mock("react-native/Libraries/Linking/Linking", () => ({ openURL: (...a: any[]) => mockOpenURL(...a) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SupportScreen = require("../mobile/app/support/index").default as React.ComponentType;
const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const texts = (node: any): string[] =>
  (node.children ?? []).flatMap((c: any) => (typeof c === "string" ? [c] : texts(c)));

async function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<SupportScreen />);
  });
  return tree;
}

beforeEach(() => jest.clearAllMocks());

describe("support contact", () => {
  it("uses the supplied email and leaves out the personal name from the source address", () => {
    expect(SUPPORT_CONTACT.email).toBe("milodating2026@gmail.com");
    const address = SUPPORT_CONTACT.addressLines.join(" ");
    expect(address).toContain("Kushinagar");
    expect(address).toContain("274802");
    expect(address).not.toMatch(/Lalbihari|S\/O/i);
  });

  it("builds a mailto link with an encoded subject", () => {
    expect(supportMailtoUrl()).toBe("mailto:milodating2026@gmail.com?subject=Chahat%20support%20request");
  });
});

describe("Help & Support screen", () => {
  it("shows the email and every address line", async () => {
    const out = texts((await render()).toJSON() as any).join("|");
    expect(out).toContain(SUPPORT_CONTACT.email);
    for (const line of SUPPORT_CONTACT.addressLines) expect(out).toContain(line);
  });

  it("is reachable from Settings and registered as a route", () => {
    expect(read("mobile/app/settings/index.tsx")).toContain('router.push("/support")');
    expect(read("mobile/app/_layout.tsx")).toContain('name="support/index"');
  });

  it("does not change the unconfirmed legal operator placeholders", () => {
    expect(read("mobile/src/constants/operatorDetails.ts")).not.toContain("milodating2026");
  });
});
