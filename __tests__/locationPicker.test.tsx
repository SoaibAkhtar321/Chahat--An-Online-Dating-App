import React from "react";
import { Linking, Text, TextInput, TouchableOpacity } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockLoad = jest.fn();
const mockManual = jest.fn();
const mockCurrent = jest.fn();
const mockConsent = jest.fn();

jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t: any, k: string) => (k in t ? t[k] : () => null) }));
jest.mock("../mobile/src/context/ThemeContext", () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => "#000000" }) }),
}));
jest.mock("../mobile/src/components/ui/Input", () => {
  const { TextInput: RNTextInput } = require("react-native");
  return { Input: (p: any) => <RNTextInput {...p} accessibilityLabel="City search" /> };
});
jest.mock("../mobile/src/components/ui/Chip", () => {
  const { TouchableOpacity: Touch, Text: Txt } = require("react-native");
  return {
    Chip: (p: any) => (
      <Touch accessibilityLabel={`chip-${p.label}`} onPress={p.onPress}>
        <Txt>{p.label}</Txt>
      </Touch>
    ),
  };
});
jest.mock("../mobile/src/services/consent", () => ({ ensureConsent: (...a: unknown[]) => mockConsent(...a) }));
jest.mock("../mobile/src/services/locationSelection", () => ({
  ...jest.requireActual("../mobile/src/services/locationSelection"),
  loadLocationSelection: (...a: unknown[]) => mockLoad(...a),
  selectCityManually: (...a: unknown[]) => mockManual(...a),
  selectCurrentLocation: (...a: unknown[]) => mockCurrent(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LocationPicker } = require("../mobile/src/components/location/LocationPicker");

const sel = (over: Record<string, unknown> = {}) => ({
  mode: "manual",
  city: "Mumbai",
  hasLocation: false,
  stale: false,
  shareDistance: true,
  ...over,
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

async function mount(onSelectionChange = jest.fn()) {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<LocationPicker onSelectionChange={onSelectionChange} />);
  });
  await flush();
  return { r, onSelectionChange };
}

const texts = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const byLabel = (r: TestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function")[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue(sel());
  mockManual.mockResolvedValue({ status: "saved", city: "Pune" });
  mockCurrent.mockResolvedValue({ status: "saved", city: "Pune" });
  mockConsent.mockResolvedValue(true);
});

describe("LocationPicker", () => {
  it('shows the title and the current selection at the top ("Selected city: Mumbai")', async () => {
    const { r, onSelectionChange } = await mount();
    const all = texts(r);
    expect(all).toContain("Your location");
    expect(all).toContain("Selected city: Mumbai");
    expect(onSelectionChange).toHaveBeenCalledWith(sel());
  });

  it("never defaults to a city when none is selected", async () => {
    mockLoad.mockResolvedValue(sel({ city: null }));
    const { r } = await mount();
    expect(texts(r)).toContain("No city selected yet");
    expect(texts(r).join(" ")).not.toMatch(/Mumbai/);
  });

  it("a popular-city chip uses the same manual selection path as search", async () => {
    const { r } = await mount();
    mockLoad.mockResolvedValue(sel({ city: "Pune" }));
    await act(async () => {
      byLabel(r, "chip-Pune").props.onPress();
    });
    await flush();
    expect(mockManual).toHaveBeenCalledWith("Pune");
    expect(texts(r)).toContain("Selected city: Pune");
  });

  it("typing in the search box lists matching cities and selecting one saves it", async () => {
    const { r } = await mount();
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText("pun");
    });
    const row = byLabel(r, "Select Pune");
    expect(row).toBeDefined();
    await act(async () => {
      row.props.onPress();
    });
    await flush();
    expect(mockManual).toHaveBeenCalledWith("Pune");
  });

  it("says when no supported city matches the search", async () => {
    const { r } = await mount();
    await act(async () => {
      r.root.findByType(TextInput).props.onChangeText("zzzz");
    });
    expect(texts(r).join(" ")).toMatch(/No supported city matches/);
  });

  it("current location asks for consent first and only then detects", async () => {
    const { r } = await mount();
    await act(async () => {
      byLabel(r, "Use my current location").props.onPress();
    });
    await flush();
    expect(mockConsent).toHaveBeenCalledWith("location_discovery");
    expect(mockCurrent).toHaveBeenCalledTimes(1);
  });

  it("declining consent skips detection and leaves manual search usable", async () => {
    mockConsent.mockResolvedValue(false);
    const { r } = await mount();
    await act(async () => {
      byLabel(r, "Use my current location").props.onPress();
    });
    await flush();
    expect(mockCurrent).not.toHaveBeenCalled();
    expect(texts(r).join(" ")).toMatch(/search for your city/i);
    expect(byLabel(r, "chip-Delhi")).toBeDefined();
  });

  it("permanently denied permission offers Open settings and keeps manual choices available", async () => {
    mockCurrent.mockResolvedValue({ status: "permission_denied", canAskAgain: false });
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    const { r } = await mount();
    await act(async () => {
      byLabel(r, "Use my current location").props.onPress();
    });
    await flush();
    expect(texts(r)).toContain("Open settings");
    const openBtn = r.root.findAllByType(TouchableOpacity).find((t) => t.findAllByType(Text).some((x) => x.props.children === "Open settings"));
    await act(async () => {
      openBtn!.props.onPress();
    });
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(byLabel(r, "chip-Mumbai")).toBeDefined();
    expect(mockCurrent).toHaveBeenCalledTimes(1); // not re-prompted
    openSettings.mockRestore();
  });

  it("ignores a second tap while a change is in flight (one change at a time)", async () => {
    let resolve!: (v: unknown) => void;
    mockCurrent.mockReturnValue(new Promise((r) => (resolve = r)));
    const { r } = await mount();
    await act(async () => {
      byLabel(r, "Use my current location").props.onPress();
      byLabel(r, "Use my current location").props.onPress();
    });
    await flush();
    expect(mockCurrent).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ status: "saved", city: "Pune" });
    });
    await flush();
  });

  it("makes the active mode clear after switching from manual to current", async () => {
    const { r } = await mount();
    mockLoad.mockResolvedValue(sel({ mode: "current", city: "Pune", hasLocation: true }));
    await act(async () => {
      byLabel(r, "Use my current location").props.onPress();
    });
    await flush();
    const all = texts(r).join(" ");
    expect(all).toMatch(/Use my current location \(active\)/);
    expect(all).not.toMatch(/Search for your city \(active\)/);
    expect(all).toMatch(/Selected city: Pune/);
  });

  it("shows an error with retry when the selection cannot be loaded", async () => {
    mockLoad.mockResolvedValueOnce(null);
    const { r } = await mount();
    expect(texts(r)).toContain("Couldn't load your location");
    expect(texts(r)).toContain("Try again");
  });
});
