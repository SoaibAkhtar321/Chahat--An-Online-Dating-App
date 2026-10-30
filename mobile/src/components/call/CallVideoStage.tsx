// Video call layout: one video fills the screen, the other sits in a small floating box.
// * Tap the small box to swap (see yourself big and the other person small, and back).
// * Drag the small box anywhere; when released it snaps to the nearest side, like WhatsApp / Meet.
// * The box stays clear of the status bar (time, network, battery) and of the call buttons at the bottom.
import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Animated, PanResponder, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CallSessionWithVideo } from "../../services/agoraCallMedia";

export const SMALL_BOX = { width: 110, height: 160 };
const EDGE = 12;
/** Space kept free at the bottom for the call buttons (mic, camera, switch, hang up). */
export const CONTROLS_CLEARANCE = 220;
const TAP_SLOP = 6;

export interface StageBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function stageBounds(width: number, height: number, insets: { top: number; bottom: number }): StageBounds {
  const minY = insets.top + EDGE;
  return {
    minX: EDGE,
    maxX: Math.max(EDGE, width - SMALL_BOX.width - EDGE),
    minY,
    maxY: Math.max(minY, height - insets.bottom - CONTROLS_CLEARANCE - SMALL_BOX.height),
  };
}

/** Where the box settles after a drag: nearest left/right side, kept inside the safe area. */
export function snapPosition(x: number, y: number, b: StageBounds): { x: number; y: number } {
  const midX = (b.minX + b.maxX) / 2;
  return {
    x: x < midX ? b.minX : b.maxX,
    y: Math.min(b.maxY, Math.max(b.minY, y)),
  };
}

export function CallVideoStage({ session }: { session: CallSessionWithVideo | null }): React.ReactElement | null {
  const surface = session?.video;
  const insets = useSafeAreaInsets();
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => (surface ? surface.subscribe(() => force()) : undefined), [surface]);

  // false: the other person is big and you are small (default). true: swapped.
  const [selfLarge, setSelfLarge] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const bounds = useMemo(
    () => (size ? stageBounds(size.width, size.height, insets) : null),
    [size, insets],
  );

  const pos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const current = useRef({ x: 0, y: 0 });
  const placed = useRef(false);
  const boundsRef = useRef<StageBounds | null>(null);
  boundsRef.current = bounds;

  // First layout: top-right corner, below the status bar.
  useEffect(() => {
    if (!bounds) return;
    const next = placed.current ? snapPosition(current.current.x, current.current.y, bounds) : { x: bounds.maxX, y: bounds.minY };
    placed.current = true;
    current.current = next;
    pos.setValue(next);
  }, [bounds, pos]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > TAP_SLOP || Math.abs(g.dy) > TAP_SLOP,
        onPanResponderMove: (_e, g) => {
          pos.setValue({ x: current.current.x + g.dx, y: current.current.y + g.dy });
        },
        onPanResponderRelease: (_e, g) => {
          if (Math.abs(g.dx) < TAP_SLOP && Math.abs(g.dy) < TAP_SLOP) {
            setSelfLarge((v) => !v);
            return;
          }
          const b = boundsRef.current;
          if (!b) return;
          const next = snapPosition(current.current.x + g.dx, current.current.y + g.dy, b);
          current.current = next;
          Animated.spring(pos, { toValue: next, useNativeDriver: false, friction: 7 }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(pos, { toValue: current.current, useNativeDriver: false }).start();
        },
      }),
    [pos],
  );

  if (!surface) return null;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || size.width !== width || size.height !== height) setSize({ width, height });
  };
  const large = selfLarge ? surface.renderLocal(false) : surface.renderRemote(false);
  const small = selfLarge ? surface.renderRemote(true) : surface.renderLocal(true);

  return (
    <View style={styles.stage} onLayout={onLayout} testID="call-video-stage">
      {large}
      {size ? (
        <Animated.View
          {...responder.panHandlers}
          style={[styles.smallBox, { transform: pos.getTranslateTransform() }]}
          accessibilityRole="button"
          accessibilityLabel={selfLarge ? "Show the other person large" : "Show yourself large"}
          accessibilityHint="Tap to swap videos. Drag to move."
          testID="call-video-small"
        >
          {small}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Video surfaces are black by nature; this is the letterbox colour, not a themed surface.
  stage: { flex: 1, width: "100%", backgroundColor: "#000" },
  smallBox: {
    position: "absolute",
    top: 0,
    left: 0,
    width: SMALL_BOX.width,
    height: SMALL_BOX.height,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#222",
    elevation: 6,
  },
});
