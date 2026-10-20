import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Animated, Dimensions, PanResponder, StyleSheet, Text, View } from "react-native";
import { Radii, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

export type SwipeAction = "like" | "pass" | "priority";

export interface SwipeableCardHandle {
  /**
   * Animates the card away and then reports the action through `onSwipe`.
   * Returns false when the card is busy or disabled (nothing happens), true when the swipe started.
   */
  swipe: (action: SwipeAction) => boolean;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/** Dragging past this share of the screen width commits the swipe. */
export const SWIPE_DISTANCE_RATIO = 0.28;
/** A quick flick commits sooner: at least this far and at least this fast (px per ms). */
export const FLING_MIN_DISTANCE = 40;
export const FLING_MIN_VELOCITY = 0.6;
const EXIT_DURATION_MS = 220;

/** Decides what a finished drag means: right = like, left = pass, anything shorter springs back (null). */
export function resolveSwipeDirection(
  dx: number,
  vx: number,
  screenWidth: number = SCREEN_WIDTH,
): "like" | "pass" | null {
  const distance = screenWidth * SWIPE_DISTANCE_RATIO;
  if (dx >= distance || (dx > FLING_MIN_DISTANCE && vx >= FLING_MIN_VELOCITY)) return "like";
  if (dx <= -distance || (dx < -FLING_MIN_DISTANCE && vx <= -FLING_MIN_VELOCITY)) return "pass";
  return null;
}

interface SwipeableCardProps {
  children: React.ReactNode;
  /** While true the card ignores drags and button-triggered swipes (for example while a swipe is being saved). */
  disabled?: boolean;
  /**
   * Called once the card has left the screen. If the caller does not replace this card (the deck did not
   * advance), the card springs back so it can never be stranded off-screen.
   */
  onSwipe: (action: SwipeAction) => void | Promise<void>;
}

export const SwipeableCard = forwardRef<SwipeableCardHandle, SwipeableCardProps>(function SwipeableCard(
  { children, disabled = false, onSwipe },
  ref,
) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const position = useRef(new Animated.ValueXY()).current;
  const committed = useRef(false);
  const mounted = useRef(true);
  const disabledRef = useRef(disabled);
  const onSwipeRef = useRef(onSwipe);
  disabledRef.current = disabled;
  onSwipeRef.current = onSwipe;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      position.stopAnimation();
    };
  }, [position]);

  const springBack = useCallback(() => {
    Animated.spring(position, {
      toValue: { x: 0, y: 0 },
      friction: 6,
      useNativeDriver: false,
    }).start();
  }, [position]);

  const commit = useCallback(
    (action: SwipeAction): boolean => {
      if (committed.current || disabledRef.current) return false;
      committed.current = true;
      const target =
        action === "priority"
          ? { x: 0, y: -SCREEN_HEIGHT }
          : { x: (action === "like" ? 1 : -1) * SCREEN_WIDTH * 1.4, y: 30 };
      Animated.timing(position, {
        toValue: target,
        duration: EXIT_DURATION_MS,
        useNativeDriver: false,
      }).start(async ({ finished }) => {
        if (!finished) return;
        try {
          await onSwipeRef.current(action);
        } catch {
          // The caller reports its own errors; this card only has to stay usable.
        }
        // Normal case: the deck advanced and this card is already unmounted. Otherwise bring it back.
        if (mounted.current) {
          committed.current = false;
          springBack();
        }
      });
      return true;
    },
    [position, springBack],
  );

  useImperativeHandle(ref, () => ({ swipe: commit }), [commit]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Only claim clearly horizontal drags so taps on the photo zones and the details button still work.
        onMoveShouldSetPanResponder: (_event, g) =>
          !disabledRef.current &&
          !committed.current &&
          Math.abs(g.dx) > 10 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
        onPanResponderMove: (_event, g) => {
          position.setValue({ x: g.dx, y: g.dy * 0.3 });
        },
        onPanResponderRelease: (_event, g) => {
          const action = resolveSwipeDirection(g.dx, g.vx);
          if (action) commit(action);
          else springBack();
        },
        onPanResponderTerminate: () => springBack(),
        onPanResponderTerminationRequest: () => false,
      }),
    [commit, position, springBack],
  );

  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ["-12deg", "0deg", "12deg"],
  });
  const likeOpacity = position.x.interpolate({
    inputRange: [0, SCREEN_WIDTH * SWIPE_DISTANCE_RATIO],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const nopeOpacity = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH * SWIPE_DISTANCE_RATIO, 0],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  return (
    <Animated.View
      testID="swipeable-card"
      {...panResponder.panHandlers}
      style={[
        styles.wrapper,
        { transform: [{ translateX: position.x }, { translateY: position.y }, { rotate }] },
      ]}
    >
      {children}
      <Animated.View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        style={[styles.stamp, styles.likeStamp, { opacity: likeOpacity }]}
      >
        <Text style={[styles.stampText, { color: colors.success }]}>LIKE</Text>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        style={[styles.stamp, styles.nopeStamp, { opacity: nopeOpacity }]}
      >
        <Text style={[styles.stampText, { color: colors.destructive }]}>NOPE</Text>
      </Animated.View>
    </Animated.View>
  );
});

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrapper: {
      alignSelf: "center",
    },
    stamp: {
      position: "absolute",
      top: 36,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderWidth: 4,
      borderRadius: Radii.md,
    },
    likeStamp: {
      left: 24,
      borderColor: colors.success,
      transform: [{ rotate: "-14deg" }],
    },
    nopeStamp: {
      right: 24,
      borderColor: colors.destructive,
      transform: [{ rotate: "14deg" }],
    },
    stampText: {
      fontSize: 32,
      fontWeight: Typography.weights.bold,
      letterSpacing: 2,
    },
  });
