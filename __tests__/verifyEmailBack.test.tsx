import React from "react";
import { BackHandler } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockReplace = jest.fn();
const mockClear = jest.fn();

jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t: any, k: string) => (k in t ? t[k] : () => null) }));
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => ({ replace: mockReplace }),
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
  };
});
jest.mock("../mobile/src/context/ThemeContext", () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => "#000000" }) }),
}));
jest.mock("../mobile/src/services/auth", () => ({
  checkSignupConfirmed: jest.fn().mockResolvedValue("pending"),
  resendConfirmation: jest.fn(),
  verifySignupCode: jest.fn(),
}));
jest.mock("../mobile/src/services/pendingSignup", () => ({
  getPendingSignup: () => null,
  clearPendingSignup: () => mockClear(),
}));

import VerifyScreen from "../mobile/app/(auth)/verify";

it("hardware back equals 'Back to log in': clears pending signup and goes to login", async () => {
  let listener: (() => boolean) | undefined;
  jest.spyOn(BackHandler, "addEventListener").mockImplementation(((_: string, fn: () => boolean) => {
    listener = fn;
    return { remove: jest.fn() };
  }) as any);
  await act(async () => {
    TestRenderer.create(<VerifyScreen />);
  });
  expect(listener!()).toBe(true);
  expect(mockClear).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledWith("/(auth)/login");
});
