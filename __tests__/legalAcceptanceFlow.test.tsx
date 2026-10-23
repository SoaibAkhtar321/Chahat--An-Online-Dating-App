Time:        5.055 s, estimated 11 s
Ran all test suites matching /__tests__\\themeCoverage.test.ts|__tests__\\chatRepliesScreen.test.tsx/i.
PS C:\Chahat> cd C:\Chahat
>> git add mobile/src/components/chat/ImageViewerModal.tsx __tests__/themeCoverage.test.ts
>> git commit -m "Fix CI: ImageViewerModal safe-area fallback, register in theme coverage"
>> git push
warning: in the working copy of 'mobile/src/components/chat/ImageViewerModal.tsx', CRLF will be replaced by LF the next time Git touches it
[main 3cb1f5a] Fix CI: ImageViewerModal safe-area fallback, register in theme coverage
 2 files changed, 19 insertions(+), 4 deletions(-)
Enumerating objects: 17, done.
Counting objects: 100% (17/17), done.
Delta compression using up to 8 threads
Compressing objects: 100% (9/9), done.
Writing objects: 100% (9/9), 1.06 KiB | 363.00 KiB/s, done.
Total 9 (delta 8), reused 0 (delta 0), pack-reused 0 (from 0)
remote: Resolving deltas: 100% (8/8), completed with 8 local objects.
remote: This repository moved. Please use the new location:
remote:   https://github.com/SoaibAkhtar321/Chahat--An-Online-Dating-App.git
To https://github.com/SoaibAkhtar321/Milo-Prototype-Baseline.git
   a6eee65..3cb1f5a  main -> main
PS C:\Chahat> git show 2145b61 -- "mobile/app/chat/[id].tsx" | Select-String "callingAvailable|isCallingAvailable" -Context 4,4
>> Get-Content __tests__\legalAcceptanceFlow.test.tsx -Raw

  @@ -17,7 +17,6 @@ import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
   import { clearActiveConversation, setActiveConversation } from 
"../../src/services/activeConversation";
   import { useScreenProtection } from "../../src/hooks/useScreenProtection";
   import { buildNewCallRoute } from "../../src/services/calls";
> -import { isCallingAvailable } from "../../src/services/callMedia";
   import { isServiceConfigured } from "../../src/config/appConfig";
   import { Image } from "expo-image";
   import * as ImagePicker from "expo-image-picker";
  @@ -44,6 +43,7 @@ import { MessageActionSheet } from "../../src/components/chat/MessageActionSheet
  @@ -106,7 +106,6 @@ export default function ChatDetailScreen() {
     const styles = useMemo(() => createStyles(Colors), [Colors]);
     const router = useRouter();
     const { id: matchId } = useLocalSearchParams<{ id: string }>();
> -  const callingAvailable = isCallingAvailable();
     // Off unless EXPO_PUBLIC_FEATURE_VOICE_MESSAGES is exactly "true" (development/test builds only).
     const voiceEnabled = isServiceConfigured("voiceMessages");
     const { user } = useAuth();
  @@ -120,6 +119,8 @@ export default function ChatDetailScreen() {
  -            <Trophy size={19} color={Colors.accent} />
  +            <Video size={20} color={Colors.primary} />
             </TouchableOpacity>
   
> -          {callingAvailable && matchId ? (
  -            <TouchableOpacity
  -              style={styles.actionIcon}
  -              accessibilityLabel="Start video call"
  -              onPress={() => router.push(buildNewCallRoute(matchId, "video"))}
import React from "react";
import * as fs from "fs";
import * as path from "path";
import TestRenderer, { act } from "react-test-renderer";
import { LightColors } from "../mobile/src/constants/theme";
import { currentLegalAcceptanceClaim } from "../mobile/src/constants/legalVersions";
import {
  LEGAL_ACCEPT_PATH,
  LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  legalGateRedirect,
  validateLegalAcceptance,
} from "../mobile/src/utils/legalGate";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSignUpUser = jest.fn();

const mockLightColors = require("../mobile/src/constants/theme").LightColors;

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
}));
jest.mock("../mobile/src/context/ThemeContext", () => ({
  useTheme: () => ({ colors: mockLightColors, isDark: false }),
}));
jest.mock("lucide-react-native", () => ({ ArrowLeft: () => null, Check: () => null }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => require("react").createElement("View", null, children),
}));
jest.mock("../mobile/src/services/auth", () => ({
  signUpUser: (...args: any[]) => mockSignUpUser(...args),
}));
jest.mock("../mobile/src/components/ui/Button", () => {
  const React = require("react");
  const MockButton = ({ title, onPress, ...props }: any) =>
    React.createElement("View", { accessibilityRole: "button", title, onPress, ...props });
  return { Button: MockButton };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SignupScreen = require("../mobile/app/(auth)/signup").default as React.ComponentType;

async function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<SignupScreen />);
  });
  return tree;
}
const byRole = (tree: TestRenderer.ReactTestRenderer, role: string) =>
  tree.root.findAll((n) => n.props?.accessibilityRole === role && typeof n.type !== "string");
const text = (tree: TestRenderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON());

async function fillAndSubmit(tree: TestRenderer.ReactTestRenderer) {
  const inputs = tree.root.findAll((n) => n.props?.placeholder && n.props?.onChangeText);
  await act(async () => {
    inputs.find((n) => n.props.placeholder === "you@example.com")!.props.onChangeText("a@example.test");
    inputs.find((n) => /8\+ characters/.test(n.props.placeholder))!.props.onChangeText("passWord1");
  });
  const signUpButton = tree.root.findAll(
    (n) => typeof n.type !== "string" && n.props?.title === "Sign up" && typeof n.props?.onPress === "function",
  )[0];
  await act(async () => {
    await signUpButton.props.onPress();
  });
}

describe("signup Terms/Privacy acceptance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignUpUser.mockResolvedValue({ success: true });
  });

  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });

  it("shows the checkbox unchecked by default with the required wording", async () => {
    const tree = await render();
    const [box] = byRole(tree, "checkbox");
    expect(box.props.accessibilityState).toEqual({ checked: false });
    const out = text(tree);
    expect(out).toContain("I have read and agree to the");
    expect(out).toContain("Terms & Conditions");
    expect(out).toContain("acknowledge the");
    expect(out).toContain("Privacy Policy");
  });

  it("blocks account creation and shows feedback when the box is not ticked", async () => {
    const tree = await render();
    await fillAndSubmit(tree);
    expect(mockSignUpUser).not.toHaveBeenCalled();
    expect(text(tree)).toContain(LEGAL_ACCEPTANCE_REQUIRED_MESSAGE);
  });

  it("creates the account with the shown versions once the box is ticked, and clears the error", async ()=> {
    const tree = await render();
    await fillAndSubmit(tree);
    await act(async () => {
      byRole(tree, "checkbox")[0].props.onPress();
    });
    expect(text(tree)).not.toContain(LEGAL_ACCEPTANCE_REQUIRED_MESSAGE);
    expect(byRole(tree, "checkbox")[0].props.accessibilityState).toEqual({ checked: true });
    await fillAndSubmit(tree);
    expect(mockSignUpUser).toHaveBeenCalledWith("a@example.test", "passWord1", currentLegalAcceptanceClaim());
  });

  it("opens the Terms and the Privacy Policy from the individual links", async () => {
    const tree = await render();
    const links = byRole(tree, "link");
    expect(links).toHaveLength(2);
    await act(async () => {
      links[0].props.onPress();
      links[1].props.onPress();
    });
    expect(mockPush).toHaveBeenNthCalledWith(1, "/legal/terms");
    expect(mockPush).toHaveBeenNthCalledWith(2, "/legal/privacy");
  });
});

describe("legal acceptance rules", () => {
  it("validateLegalAcceptance requires an explicit tick", () => {
    expect(validateLegalAcceptance(false)).toBe(LEGAL_ACCEPTANCE_REQUIRED_MESSAGE);
    expect(validateLegalAcceptance(true)).toBeUndefined();
  });

  it("gate redirects only signed-in users whose acceptance is known to be required", () => {
    const base = { isLoggedIn: true, legalStatus: "required" as const, pathname: "/(tabs)/discover" };
    expect(legalGateRedirect(base)).toBe(LEGAL_ACCEPT_PATH);
    expect(legalGateRedirect({ ...base, isLoggedIn: false })).toBeNull();
    expect(legalGateRedirect({ ...base, legalStatus: "accepted" })).toBeNull();
    expect(legalGateRedirect({ ...base, legalStatus: "unknown" })).toBeNull();
    expect(legalGateRedirect({ ...base, legalStatus: "error" })).toBeNull();
  });

  it("keeps the documents and the acceptance screen reachable while acceptance is pending", () => {
    for (const pathname of ["/legal/accept", "/legal/terms", "/legal/privacy"]) {
      expect(legalGateRedirect({ isLoggedIn: true, legalStatus: "required", pathname })).toBeNull();
    }
  });

  it("registers the gate and the acceptance route in the root layout", () => {
    const layout = fs.readFileSync(path.join(__dirname, "..", "mobile", "app", "_layout.tsx"), "utf8");
    expect(layout).toContain("<LegalGate />");
    expect(layout).toContain('name="legal/accept"');
  });
});

describe("legalAcceptance service", () => {
  const mockSelectResult = jest.fn();
  const mockRpc = jest.fn();
  const eqCalls: [string, unknown][] = [];
  let svc: typeof import("../mobile/src/services/legalAcceptance");

  beforeAll(() => {
    jest.resetModules();
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        eqCalls.push([col, val]);
        return chain;
      },
      limit: () => mockSelectResult(),
    };
    jest.doMock("../mobile/src/services/supabase", () => ({
      supabase: { from: () => chain, rpc: (...a: any[]) => mockRpc(...a) },
    }));
    svc = require("../mobile/src/services/legalAcceptance");
  });
  beforeEach(() => {
    eqCalls.length = 0;
    mockSelectResult.mockReset();
    mockRpc.mockReset();
  });

  it("existing users with no row for the current versions are 'required' (never auto-accepted)", async ()=> {
    mockSelectResult.mockResolvedValue({ data: [], error: null });
    await expect(svc.fetchLegalStatus("u1")).resolves.toBe("required");
    expect(eqCalls).toEqual([
      ["user_id", "u1"],
      ["terms_version", currentLegalAcceptanceClaim().terms_version],
      ["privacy_version", currentLegalAcceptanceClaim().privacy_version],
    ]);
  });

  it("reports 'accepted' only when a row for the current versions exists, and surfaces query errors", async () => {
    mockSelectResult.mockResolvedValueOnce({ data: [{ id: "x" }], error: null });
    await expect(svc.fetchLegalStatus("u1")).resolves.toBe("accepted");
    mockSelectResult.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(svc.fetchLegalStatus("u1")).rejects.toThrow("boom");
  });

  it("accepts through the server RPC with the shown versions and the reacceptance method", async () => {
    mockRpc.mockResolvedValue({ error: null });
    await expect(svc.acceptCurrentLegalDocuments()).resolves.toEqual({ success: true });
    expect(mockRpc).toHaveBeenCalledWith("accept_current_legal_documents", {
      _terms_version: currentLegalAcceptanceClaim().terms_version,
      _privacy_version: currentLegalAcceptanceClaim().privacy_version,
      _method: "reacceptance_prompt",
    });
  });

  it("tells the user to update the app when the server has newer documents; other failures are retryable", async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: "22023", message: "changed" } });
    expect(await svc.acceptCurrentLegalDocuments()).toMatchObject({ success: false, outdated: true });
    mockRpc.mockResolvedValueOnce({ error: { code: "XX000", message: "x" } });
    expect(await svc.acceptCurrentLegalDocuments()).toMatchObject({ success: false });
    mockRpc.mockRejectedValueOnce(new Error("network"));
    expect(await svc.acceptCurrentLegalDocuments()).toMatchObject({ success: false });
  });
});



PS C:\Chahat> 