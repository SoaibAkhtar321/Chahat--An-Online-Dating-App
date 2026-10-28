import React from "react";
import { Linking, Text, TextInput, TouchableOpacity } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockLoad = jest.fn();
const mockManual = jest.fn();
const mockCurrent = jest.fn();
const mockSearch = jest.fn();
const mockConsent = jest.fn();

jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t: any, k: string) => (k in t ? t[k] : () => null) }));
jest.mock("../mobile/src/context/ThemeContext", () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => "#000000" }) }),
}));
jest.mock("../mobile/src/components/ui/Input", () => {
  const { TextInput: RNTextInput } = require("react-native");
  return { Input: (p: any) => <RNTextInput {...p} /> };
});
jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { rpc: jest.fn() },
}));
jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3, High: 4 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  enableNetworkProviderAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
}));
jest.mock("../mobile/src/services/consent", () => ({ ensureConsent: (...a: unknown[]) => mockConsent(...a) }));
jest.mock("../mobile/src/services/locationSelection", () => ({
  ...jest.requireActual("../mobile/src/services/locationSelection"),
  loadLocationSelection: (...a: unknown[]) => mockLoad(...a),
  selectCityManually: (...a: unknown[]) => mockManual(...a),
  selectCurrentLocation: (...a: unknown[]) => mockCurrent(...a),
  searchCities: (...a: unknown[]) => mockSearch(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LocationPicker, SEARCH_DEBOUNCE_MS } = require("../mobile/src/components/location/LocationPicker");

const sel = (over: Record<string, unknown> = {}) => ({
  mode: "manual",
  city: "Kolkata",
  state: "West Bengal",
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
const byText = (r: TestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAllByType(TouchableOpacity).find((t) => t.findAllByType(Text).some((x) => x.props.children === label));

async function type(r: TestRenderer.ReactTestRenderer, value: string) {
  await act(async () => {
    r.root.findByType(TextInput).props.onChangeText(value);
  });
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 1);
  });
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockLoad.mockResolvedValue(sel());
  mockManual.mockResolvedValue({ status: "saved", city: "Kushinagar" });
  mockCurrent.mockResolvedValue({ status: "saved", city: "Greater Noida" });
  mockSearch.mockResolvedValue({ status: "ok", results: [] });
  mockConsent.mockResolvedValue(true);
});
afterEach(() => jest.useRealTimers());

describe("LocationPicker", () => {
  it('shows the title and the current selection at the top ("Selected city: Kolkata")', async () => {
    const { r, onSelectionChange } = await mount();
    const all = texts(r);
    expect(all).toContain("Your location");
    expect(all).toContain("Selected city: Kolkata");
    expect(onSelectionChange).toHaveBeenCalledWith(sel());
  });

  it("offers exactly two options: Search City and Use My Current Location (no city chips)", async () => {
    const { r } = await mount();
    const all = texts(r);
    expect(all).toContain("Search City (active)");
    expect(all).toContain("Use My Current Location");
    expect(all.join(" ")).not.toMatch(/Popular cities/);
    expect(r.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("chip-"))).toHaveLength(0);
    expect(r.root.findAllByType(TextInput)).toHaveLength(1);
  });

  it("never defaults to a city (no Pune) when none is selected", async () => {
    mockLoad.mockResolvedValue(sel({ city: null, state: null }));
    const { r } = await mount();
    expect(texts(r)).toContain("No city selected yet");
    expect(texts(r).join(" ")).not.toMatch(/Selected city|Pune/);
  });

  it.each([
    ["Greater Noida", [{ name: "Greater Noida", state: "Uttar Pradesh" }]],
    ["Kushinagar", [{ name: "Kushinagar", state: "Uttar Pradesh" }]],
    ["Kolkata", [{ name: "Kolkata", state: "West Bengal" }]],
  ])("typing %s searches the server and selecting the result saves it", async (q, results) => {
    mockSearch.mockResolvedValue({ status: "ok", results });
    const { r } = await mount();
    await type(r, q);
    expect(mockSearch).toHaveBeenCalledWith(q);
    const row = byLabel(r, `Select ${q}, ${results[0].state}`);
    expect(row).toBeDefined();
    await act(async () => {
      row.props.onPress();
    });
    await flush();
    expect(mockManual).toHaveBeenCalledWith(q);
  });

  it("lists both Gorakhpurs with the state in the name and selects the exact one", async () => {
    mockSearch.mockResolvedValue({
      status: "ok",
      results: [
        { name: "Gorakhpur, Uttar Pradesh", state: "Uttar Pradesh" },
        { name: "Gorakhpur, Haryana", state: "Haryana" },
      ],
    });
    const { r } = await mount();
    await type(r, "Gorakhpur");
    const row = byLabel(r, "Select Gorakhpur, Uttar Pradesh");
    await act(async () => {
      row.props.onPress();
    });
    await flush();
    expect(mockManual).toHaveBeenCalledWith("Gorakhpur, Uttar Pradesh");
  });

  it("debounces typing: only the final query hits the server", async () => {
    const { r } = await mount();
    await act(async () => {
      const input = r.root.findByType(TextInput);
      input.props.onChangeText("ku");
      input.props.onChangeText("kus");
      input.props.onChangeText("kush");
    });
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 1);
    });
    await flush();
    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith("kush");
  });

  it("does not search for a single letter", async () => {
    const { r } = await mount();
    await type(r, "k");
    expect(mockSearch).not.toHaveBeenCalled();
    expect(texts(r)).toContain("Keep typing…");
  });

  it("says when no place matches, and shows a retry on search errors", async () => {
    const { r } = await mount();
    await type(r, "zzzz");
    expect(texts(r).join(" ")).toMatch(/No city or town in India matches/);
    mockSearch.mockResolvedValue({ status: "error", message: "Couldn't search cities right now." });
    await type(r, "zzzzz");
    expect(texts(r)).toContain("Couldn't search cities right now.");
    expect(byText(r, "Retry search")).toBeDefined();
  });

  it("Use My Current Location asks for consent first and only then detects", async () => {
    const { r } = await mount();
    await act(async () => {
      byLabel(r, "Use My Current Location").props.onPress();
    });
    await flush();
    expect(mockConsent).toHaveBeenCalledWith("location_discovery");
    expect(mockCurrent).toHaveBeenCalledTimes(1);
  });

  it("declining consent skips detection and leaves Search City usable", async () => {
    mockConsent.mockResolvedValue(false);
    const { r } = await mount();
    await act(async () => {
      byLabel(r, "Use My Current Location").props.onPress();
    });
    await flush();
    expect(mockCurrent).not.toHaveBeenCalled();
    expect(texts(r).join(" ")).toMatch(/search for your city/i);
    expect(r.root.findByType(TextInput).props.editable).toBe(true);
  });

  it("permanently denied permission offers Open app settings and does not re-prompt", async () => {
    mockCurrent.mockResolvedValue({ status: "permission_denied", canAskAgain: false });
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    const { r } = await mount();
    await act(async () => {
      byLabel(r, "Use My Current Location").props.onPress();
    });
    await flush();
    expect(byText(r, "Try again")).toBeUndefined();
    await act(async () => {
      byText(r, "Open app settings")!.props.onPress();
    });
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(mockCurrent).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });

  it("disabled location services offers Open location settings", async () => {
    mockCurrent.mockResolvedValue({ status: "services_disabled" });
    const { r } = await mount();
    await act(async () => {
      byLabel(r, "Use My Current Location").props.onPress();
    });
    await flush();
    expect(byText(r, "Open location settings")).toBeDefined();
  });

  it("a GPS timeout offers Try again, and retrying succeeds", async () => {
    mockCurrent.mockResolvedValueOnce({ status: "timeout" });
    const { r } = await mount();
    await act(async () => {
      byLabel(r, "Use My Current Location").props.onPress();
    });
    await flush();
    expect(texts(r).join(" ")).toMatch(/fresh location fix/);
    mockLoad.mockResolvedValue(sel({ mode: "current", city: "Greater Noida", state: "Uttar Pradesh", hasLocation: true }));
    await act(async () => {
      byText(r, "Try again")!.props.onPress();
    });
    await flush();
    expect(mockCurrent).toHaveBeenCalledTimes(2);
    expect(texts(r)).toContain("Selected city: Greater Noida");
  });

  it("ignores a second tap while a change is in flight (one change at a time)", async () => {
    let resolve!: (v: unknown) => void;
    mockCurrent.mockReturnValue(new Promise((res) => (resolve = res)));
    const { r } = await mount();
    await act(async () => {
      byLabel(r, "Use My Current Location").props.onPress();
      byLabel(r, "Use My Current Location").props.onPress();
    });
    await flush();
    expect(mockCurrent).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ status: "saved", city: "Greater Noida" });
    });
    await flush();
  });

  it("makes the active mode clear after switching from manual to current", async () => {
    const { r } = await mount();
    mockLoad.mockResolvedValue(sel({ mode: "current", city: "Greater Noida", hasLocation: true }));
    await act(async () => {
      byLabel(r, "Use My Current Location").props.onPress();
    });
    await flush();
    const all = texts(r).join(" ");
    expect(all).toMatch(/Use My Current Location \(active\)/);
    expect(all).not.toMatch(/Search City \(active\)/);
    expect(all).toMatch(/Selected city: Greater Noida/);
  });

  it("shows an error with retry when the selection cannot be loaded", async () => {
    mockLoad.mockResolvedValueOnce(null);
    const { r } = await mount();
    expect(texts(r)).toContain("Couldn't load your location");
    expect(texts(r)).toContain("Try again");
  });
});
