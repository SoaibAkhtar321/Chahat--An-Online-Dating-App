import React from "react";
import { Modal } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import { safeBack, hasUnsavedChanges } from "../mobile/src/utils/navigation";
import { centerCropRect } from "../mobile/src/utils/cropMath";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);
const mockAlert = jest.fn();
jest.mock("../mobile/src/utils/alert", () => ({ Alert: { alert: (...a: unknown[]) => mockAlert(...a) } }));
jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t: any, k: string) => (k in t ? t[k] : () => null) }));
jest.mock("../mobile/src/components/ui/Slider", () => ({ Slider: () => null, RangeSlider: () => null }));
jest.mock("../mobile/src/components/ui/Button", () => ({ Button: () => null }));
jest.mock("../mobile/src/components/ui/Chip", () => ({ Chip: () => null }));

const mockManipulate = jest.fn();
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: (...a: unknown[]) => mockManipulate(...a),
  SaveFormat: { JPEG: "jpeg" },
}), { virtual: true });
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FilterModal } = require("../mobile/src/components/discovery/FilterModal");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PhotoPreviewModal } = require("../mobile/src/components/profile/PhotoPreviewModal");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DEFAULT_FILTERS } = require("../mobile/src/types");

// Unmount every renderer after each test: a mounted TouchableOpacity keeps animating after the suite ends,
// which logged "Cannot log after tests are done" and made the whole Jest run exit 1 although all tests passed.
const mounted: TestRenderer.ReactTestRenderer[] = [];
function create(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  const renderer = TestRenderer.create(element);
  mounted.push(renderer);
  return renderer;
}
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((renderer) => renderer.unmount());
  });
});

describe("safeBack", () => {
  test("goes back when history exists, otherwise replaces with the fallback", () => {
    const router = { canGoBack: jest.fn(() => true), back: jest.fn(), replace: jest.fn() };
    safeBack(router);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();

    router.canGoBack.mockReturnValue(false);
    safeBack(router, "/(auth)/welcome");
    expect(router.replace).toHaveBeenCalledWith("/(auth)/welcome");
    safeBack(router);
    expect(router.replace).toHaveBeenLastCalledWith("/(tabs)/discover");
  });
  test("hasUnsavedChanges compares values", () => {
    expect(hasUnsavedChanges({ a: 1 }, { a: 1 })).toBe(false);
    expect(hasUnsavedChanges({ a: 1 }, { a: 2 })).toBe(true);
  });
});

describe("centerCropRect (3:4)", () => {
  test("landscape crops width", () => {
    expect(centerCropRect(4000, 3000)).toEqual({ originX: 875 + 0, originY: 0, width: 2250, height: 3000 });
  });
  test("tall crops height", () => {
    const r = centerCropRect(1000, 2000);
    expect(r.width).toBe(1000);
    expect(r.height).toBe(1333);
    expect(r.originY).toBe(333);
  });
  test("already 3:4 is unchanged; bad sizes give an empty rect", () => {
    expect(centerCropRect(750, 1000)).toEqual({ originX: 0, originY: 0, width: 750, height: 1000 });
    expect(centerCropRect(0, 10).width).toBe(0);
  });
});

describe("FilterModal Android back", () => {
  const mount = (onClose = jest.fn()) => {
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = create(
        <FilterModal visible filters={DEFAULT_FILTERS} onClose={onClose} onApply={jest.fn()} />,
      );
    });
    return { r, onClose };
  };

  test("Modal has onRequestClose, and back closes when nothing changed", () => {
    const { r, onClose } = mount();
    const modal = r.root.findByType(Modal);
    expect(typeof modal.props.onRequestClose).toBe("function");
    act(() => modal.props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  test("the X button behaves the same as hardware back", () => {
    const { r, onClose } = mount();
    const x = r.root.findAll((n) => n.props?.testID === "filters-close" && n.props.onPress)[0]!;
    act(() => x.props.onPress());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("PhotoPreviewModal", () => {
  const PHOTO = { uri: "file:///p.jpg", width: 4000, height: 3000 };
  const byId = (r: TestRenderer.ReactTestRenderer, id: string) =>
    r.root.findAll((n) => n.props?.testID === id && typeof n.props.onPress === "function")[0] ?? null;
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  beforeEach(() => jest.clearAllMocks());

  test("Done confirms the original photo without cropping", async () => {
    const onDone = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = create(<PhotoPreviewModal photo={PHOTO} onDone={onDone} onCancel={jest.fn()} />); });
    await act(async () => { await byId(r, "photo-done")!.props.onPress(); });
    expect(onDone).toHaveBeenCalledWith(PHOTO);
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  test("Crop applies a real 3:4 crop, Done then returns the cropped file; Undo restores", async () => {
    mockManipulate.mockResolvedValue({ uri: "file:///c.jpg", width: 2250, height: 3000 });
    const onDone = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = create(<PhotoPreviewModal photo={PHOTO} onDone={onDone} onCancel={jest.fn()} />); });
    await act(async () => { await byId(r, "photo-crop")!.props.onPress(); });
    expect(mockManipulate).toHaveBeenCalledWith(PHOTO.uri, [{ crop: { originX: 875, originY: 0, width: 2250, height: 3000 } }], expect.anything());
    expect(byId(r, "photo-undo-crop")).not.toBeNull();
    await act(async () => { await byId(r, "photo-done")!.props.onPress(); });
    expect(onDone).toHaveBeenCalledWith({ uri: "file:///c.jpg", width: 2250, height: 3000 });

    await act(async () => { byId(r, "photo-undo-crop")!.props.onPress(); });
    expect(byId(r, "photo-crop")).not.toBeNull();
  });

  test("a failed crop keeps the original usable", async () => {
    mockManipulate.mockRejectedValue(new Error("boom"));
    const onDone = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = create(<PhotoPreviewModal photo={PHOTO} onDone={onDone} onCancel={jest.fn()} />); });
    await act(async () => { await byId(r, "photo-crop")!.props.onPress(); });
    expect(mockAlert).toHaveBeenCalled();
    await act(async () => { await byId(r, "photo-done")!.props.onPress(); });
    expect(onDone).toHaveBeenCalledWith(PHOTO);
  });

  test("double-tapping Done confirms once", async () => {
    let finish!: () => void;
    const onDone = jest.fn(() => new Promise<void>((res) => (finish = res)));
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = create(<PhotoPreviewModal photo={PHOTO} onDone={onDone} onCancel={jest.fn()} />); });
    await act(async () => { byId(r, "photo-done")!.props.onPress(); byId(r, "photo-done")!.props.onPress(); });
    expect(onDone).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    await flush();
  });

  test("hardware back cancels; renders nothing without a photo", () => {
    const onCancel = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    act(() => { r = create(<PhotoPreviewModal photo={PHOTO} onDone={jest.fn()} onCancel={onCancel} />); });
    act(() => r.root.findByType(Modal).props.onRequestClose());
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => { r = create(<PhotoPreviewModal photo={null} onDone={jest.fn()} onCancel={onCancel} />); });
    expect(r.toJSON()).toBeNull();
  });
});
