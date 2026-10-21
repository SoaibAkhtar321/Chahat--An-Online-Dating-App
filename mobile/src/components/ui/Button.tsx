import React, { useMemo } from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  StyleProp,
  TextStyle,
} from "react-native";
import { Layout, Radii, Shadows, Spacing, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "danger" | "outline" | "text";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: TextStyle;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  style,
  textStyle,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);

  const getVariantStyle = (): ViewStyle => {
    switch (variant) {
      case "ghost":
        return styles.ghost;
      case "danger":
        return styles.danger;
      case "outline":
        return styles.outline;
      case "text":
        return styles.textVariant;
      case "primary":
      default:
        return styles.primary;
    }
  };

  const getTextStyle = (): TextStyle => {
    switch (variant) {
      case "ghost":
        return styles.ghostText;
      case "danger":
        return styles.dangerText;
      case "outline":
        return styles.outlineText;
      case "text":
        return styles.textVariantText;
      case "primary":
      default:
        return styles.primaryText;
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        styles.base,
        styles[size],
        getVariantStyle(),
        (disabled || loading) && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={
            variant === "primary" || variant === "danger"
              ? Colors.primaryForeground
              : Colors.primary
          }
        />
      ) : (
        <>
          {icon}
          <Text style={[styles.baseText, getTextStyle(), textStyle]}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radii.full,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  sm: {
    height: Layout.minTap,
  },
  md: {
    height: Layout.buttonHeight,
  },
  lg: {
    height: 56,
  },
  primary: {
    backgroundColor: Colors.primary,
    ...Shadows.glow,
  },
  ghost: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  danger: {
    backgroundColor: Colors.destructive,
  },
  outline: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  textVariant: {
    backgroundColor: "transparent",
  },
  disabled: {
    opacity: 0.5,
  },
  baseText: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
  },
  primaryText: {
    color: Colors.primaryForeground,
  },
  ghostText: {
    color: Colors.foreground,
  },
  dangerText: {
    color: Colors.destructiveForeground,
  },
  outlineText: {
    color: Colors.primary,
  },
  textVariantText: {
    color: Colors.mutedForeground,
    fontWeight: Typography.weights.semibold,
  },
});
