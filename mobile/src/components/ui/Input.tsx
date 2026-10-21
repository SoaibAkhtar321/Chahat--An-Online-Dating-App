import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  TextInputProps,
  ViewStyle,
} from "react-native";
import { Layout, Radii, Spacing, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  containerStyle?: ViewStyle;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  hint,
  containerStyle,
  style,
  secureTextEntry,
  ...props
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const [revealed, setRevealed] = useState(false);
  const isPassword = !!secureTextEntry;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.field}>
        <TextInput
          placeholderTextColor={Colors.placeholder}
          accessibilityLabel={label}
          secureTextEntry={isPassword && !revealed}
          style={[
            styles.input,
            isPassword ? styles.inputWithAction : null,
            error ? styles.inputError : null,
            style,
          ]}
          {...props}
        />
        {isPassword ? (
          <TouchableOpacity
            onPress={() => setRevealed((v) => !v)}
            style={styles.action}
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            activeOpacity={0.7}
          >
            <Text style={styles.actionText}>{revealed ? "Hide" : "Show"}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}
    </View>
  );
};

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      width: "100%",
      marginBottom: Layout.fieldGap,
    },
    label: {
      fontSize: Typography.sizes.sm,
      fontWeight: Typography.weights.semibold,
      color: Colors.foreground,
      marginBottom: Spacing.sm,
    },
    field: {
      justifyContent: "center",
    },
    input: {
      height: Layout.inputHeight,
      backgroundColor: Colors.inputBackground,
      borderWidth: 1,
      borderColor: Colors.border,
      borderRadius: Radii.md,
      paddingHorizontal: Spacing.lg,
      fontSize: Typography.sizes.base,
      color: Colors.foreground,
    },
    // Leaves room for the show/hide button so text never runs underneath it.
    inputWithAction: {
      paddingRight: 64,
    },
    inputError: {
      borderColor: Colors.destructive,
    },
    action: {
      position: "absolute",
      right: Spacing.xs,
      minWidth: Layout.minTap,
      height: Layout.minTap,
      paddingHorizontal: Spacing.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    actionText: {
      fontSize: Typography.sizes.sm,
      fontWeight: Typography.weights.semibold,
      color: Colors.mutedForeground,
    },
    errorText: {
      fontSize: Typography.sizes.sm,
      color: Colors.destructive,
      marginTop: Spacing.xs,
      fontWeight: Typography.weights.medium,
    },
    hintText: {
      fontSize: Typography.sizes.sm,
      color: Colors.mutedForeground,
      marginTop: Spacing.xs,
    },
  });
