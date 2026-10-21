import React, { useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  LayoutChangeEvent,
  ViewStyle,
  Platform,
} from "react-native";
import { Radii, Typography, ThemeColors, Spacing } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  prefix?: string;
  displayValue?: string;
  onChange: (value: number) => void;
  containerStyle?: ViewStyle;
}

export const Slider: React.FC<SliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  unit = "",
  prefix = "",
  displayValue,
  onChange,
  containerStyle,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const [trackWidth, setTrackWidth] = useState<number>(0);
  const trackRef = useRef<View>(null);

  const clampedVal = Math.max(min, Math.min(max, value));
  const range = max - min || 1;
  const ratio = (clampedVal - min) / range;

  const handleUpdate = useCallback(
    (touchX: number) => {
      if (trackWidth <= 0) return;
      const boundedX = Math.max(0, Math.min(trackWidth, touchX));
      const rawVal = min + (boundedX / trackWidth) * (max - min);
      const stepped = Math.round(rawVal / step) * step;
      const finalVal = Math.max(min, Math.min(max, stepped));
      onChange(finalVal);
    },
    [trackWidth, min, max, step, onChange]
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        handleUpdate(evt.nativeEvent.locationX);
      },
      onPanResponderMove: (evt) => {
        handleUpdate(evt.nativeEvent.locationX);
      },
    })
  ).current;

  const onLayoutTrack = (e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  };

  const formattedDisplay =
    displayValue !== undefined
      ? displayValue
      : `${prefix}${clampedVal}${unit ? ` ${unit}` : ""}`;

  return (
    <View style={[styles.container, containerStyle]}>
      {(label || displayValue !== undefined || unit) && (
        <View style={styles.header}>
          {label ? <Text style={styles.label}>{label}</Text> : <View />}
          <Text style={styles.valueText}>{formattedDisplay}</Text>
        </View>
      )}

      {/* Web accessible range input hidden or visible fallback */}
      {Platform.OS === "web" ? (
        <div style={{ width: "100%", padding: "6px 0" }}>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={clampedVal}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{
              width: "100%",
              accentColor: Colors.primary,
              cursor: "pointer",
              height: 24,
            }}
          />
        </div>
      ) : (
        <View
          style={styles.touchArea}
          {...panResponder.panHandlers}
          ref={trackRef}
          onLayout={onLayoutTrack}
        >
          <View style={styles.track}>
            <View style={[styles.filledTrack, { width: `${Math.round(ratio * 100)}%` }]} />
          </View>
          <View
            style={[
              styles.thumb,
              {
                left: `${Math.round(ratio * 100)}%`,
                transform: [{ translateX: -12 }],
              },
            ]}
          />
        </View>
      )}

      <View style={styles.boundsRow}>
        <Text style={styles.boundText}>
          {prefix}
          {min}
          {unit ? ` ${unit}` : ""}
        </Text>
        <Text style={styles.boundText}>
          {prefix}
          {max}
          {unit ? ` ${unit}` : ""}
        </Text>
      </View>
    </View>
  );
};

interface RangeSliderProps {
  label?: string;
  minVal: number;
  maxVal: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  prefix?: string;
  onChange: (minVal: number, maxVal: number) => void;
  containerStyle?: ViewStyle;
}

export const RangeSlider: React.FC<RangeSliderProps> = ({
  label,
  minVal,
  maxVal,
  min,
  max,
  step = 1,
  unit = "",
  prefix = "",
  onChange,
  containerStyle,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  return (
    <View style={[styles.container, containerStyle]}>
      {(label || unit) && (
        <View style={styles.header}>
          {label ? <Text style={styles.label}>{label}</Text> : <View />}
          <Text style={styles.valueText}>
            {prefix}
            {minVal} – {prefix}
            {maxVal}
            {unit ? ` ${unit}` : ""}
          </Text>
        </View>
      )}

      {Platform.OS === "web" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", marginTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: Typography.sizes.sm, color: Colors.mutedForeground, minWidth: 32 }}>Min</span>
            <input
              type="range"
              min={min}
              max={maxVal - 1}
              step={step}
              value={minVal}
              onChange={(e) => {
                const nextMin = Number(e.target.value);
                onChange(Math.min(nextMin, maxVal - 1), maxVal);
              }}
              style={{
                flex: 1,
                accentColor: Colors.primary,
                cursor: "pointer",
                height: 20,
              }}
            />
            <span style={{ fontSize: Typography.sizes.sm, fontWeight: "600", color: Colors.foreground, minWidth: 28, textAlign: "right" }}>
              {minVal}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: Typography.sizes.sm, color: Colors.mutedForeground, minWidth: 32 }}>Max</span>
            <input
              type="range"
              min={minVal + 1}
              max={max}
              step={step}
              value={maxVal}
              onChange={(e) => {
                const nextMax = Number(e.target.value);
                onChange(minVal, Math.max(nextMax, minVal + 1));
              }}
              style={{
                flex: 1,
                accentColor: Colors.primary,
                cursor: "pointer",
                height: 20,
              }}
            />
            <span style={{ fontSize: Typography.sizes.sm, fontWeight: "600", color: Colors.foreground, minWidth: 28, textAlign: "right" }}>
              {maxVal}
            </span>
          </div>
        </div>
      ) : (
        <View style={styles.dualSlidersRow}>
          <Slider
            label="Minimum"
            value={minVal}
            min={min}
            max={maxVal - 1}
            step={step}
            onChange={(nextMin) => onChange(Math.min(nextMin, maxVal - 1), maxVal)}
            containerStyle={{ marginBottom: 8 }}
          />
          <Slider
            label="Maximum"
            value={maxVal}
            min={minVal + 1}
            max={max}
            step={step}
            onChange={(nextMax) => onChange(minVal, Math.max(nextMax, minVal + 1))}
            containerStyle={{ marginBottom: 0 }}
          />
        </View>
      )}
    </View>
  );
};

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    width: "100%",
    marginBottom: Spacing.lg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.sm,
  },
  label: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  valueText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  touchArea: {
    height: 36,
    justifyContent: "center",
    position: "relative",
  },
  track: {
    height: 6,
    backgroundColor: Colors.secondary,
    borderRadius: 3,
    overflow: "hidden",
  },
  filledTrack: {
    height: "100%",
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  thumb: {
    position: "absolute",
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.card,
    borderWidth: 2.5,
    borderColor: Colors.primary,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  boundsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: Spacing.xs,
  },
  boundText: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
  },
  dualSlidersRow: {
    width: "100%",
    gap: Spacing.sm,
  },
});
