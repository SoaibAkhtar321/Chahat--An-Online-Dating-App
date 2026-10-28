import React from "react";
import { BackHandler } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
// The screen is behind the verification switch (off for launch); this suite tests the screen itself.
jest.mock("../mobile/src/constants/features", () => ({ VERIFICATION_ENABLED: true }));

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockAlert = jest.fn();
let mockStatus = "none";

jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t: any, k: string) => (k in t ? t[k] : () => null) }));
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => ({ canGoBack: () => true, back: mockBack, replace: mockReplace }),
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
  };
});
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: "file://selfie.jpg" }] }),
  CameraType: { front: "front" },
  MediaTypeOptions: { Images: "Images" },
}));
jest.mock("../mobile/src/context/ThemeContext", () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => "#000000" }) }),
}));
jest.mock("../mobile/src/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, profile: { verificationStatus: mockStatus }, refreshProfile: jest.fn() }),
}));
jest.mock("../mobile/src/services/profile", () => ({ saveProfile: jest.fn(), uploadVerificationSelfie: jest.fn() }));
jest.mock("../mobile/src/services/notifications", () => ({ pushNotificationToInbox: jest.fn() }));
jest.mock("../mobile/src/utils/alert", () => ({ Alert: { alert: (...a: any[]) => mockAlert(...a) } }));

import VerificationScreen from "../mobile/app/verification/index";

let backListener: (() => boolean) | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = "none";
  backListener = undefined;
  jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_: string, fn: () => boolean) => {
    backListener = fn;
    return { remove: jest.fn() };
  }) as any);
});

async function render() {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<VerificationScreen />);
  });
  return r;
}

describe("verification screen back", () => {
  it("leaves immediately when no selfie was taken", async () => {
    await render();
    expect(backListener!()).toBe(true);
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("asks before discarding an unsent selfie, and Discard leaves", async () => {
    const r = await render();
    const take = r.root.findAll((n) => n.props.title === "Take a selfie" && typeof n.props.onPress === "function")[0];
    await act(async () => {
      await take.props.onPress();
    });
    expect(backListener!()).toBe(true);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const buttons = mockAlert.mock.calls[0][2];
    act(() => buttons.find((b: any) => b.text === "Discard").onPress());
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("does not prompt once the status is pending", async () => {
    mockStatus = "pending";
    await render();
    backListener!();
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
