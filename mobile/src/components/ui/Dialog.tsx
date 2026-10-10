import React from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from "react-native";
import { Colors, Radii, Shadows, Typography } from "../../constants/theme";
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
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={styles.overlay}>
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
                  style={styles.actionButton}
                />
                <Button
                  title={cancelText}
                  variant="ghost"
                  onPress={onCancel}
                  style={styles.actionButton}
                />
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  content: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: Colors.card,
    borderRadius: Radii.xxl,
    padding: 24,
    ...Shadows.card,
  },
  title: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: 8,
    textAlign: "center",
  },
  body: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 20,
  },
  actions: {
    gap: 10,
    marginTop: 10,
  },
  actionButton: {
    width: "100%",
  },
});
