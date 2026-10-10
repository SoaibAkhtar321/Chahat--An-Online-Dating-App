import React from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  StyleProp,
  TextStyle,
} from "react-native";
import { Colors, Radii, Shadows, Typography } from "../../constants/theme";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "danger" | "outline";
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
  const getVariantStyle = (): ViewStyle => {
    switch (variant) {
      case "ghost":
        return styles.ghost;
      case "danger":
        return styles.danger;
      case "outline":
        return styles.outline;
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

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radii.full,
    paddingHorizontal: 20,
    gap: 8,
  },
  sm: {
    height: 40,
  },
  md: {
    height: 50,
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
});
