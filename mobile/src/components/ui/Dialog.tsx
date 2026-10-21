import React, { useMemo } from "react";
import {
  Modal,
  KeyboardAvoidingView,
  Platform,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from "react-native";
import { Radii, Shadows, Typography, ThemeColors, Spacing } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "./Button";

interface DialogProps {
  visible: boolean;
  title: string;
  body: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export const Dialog: React.FC<DialogProps> = ({
  visible,
  title,
  body,
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
  children,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <TouchableWithoutFeedback onPress={onCancel}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <TouchableWithoutFeedback>
            <View style={styles.content}>
              <Text style={styles.title}>{title}</Text>
              {body ? <Text style={styles.body}>{body}</Text> : null}
              {children}
              <View style={styles.actions}>
                <Button
                  title={confirmText}
                  variant={danger ? "danger" : "primary"}
                  onPress={onConfirm}
                  size="lg"
                  style={styles.actionButton}
                />
                <Button
                  title={cancelText}
                  variant="text"
                  onPress={onCancel}
                  style={styles.actionButton}
                />
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  content: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: Colors.card,
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    ...Shadows.card,
  },
  title: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: Spacing.sm,
    textAlign: "center",
  },
  body: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: Spacing.lg,
  },
  actions: {
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  actionButton: {
    width: "100%",
  },
});
