import React, { useMemo } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from "react-native";
import { Trash2, Users } from "lucide-react-native";
import { Radii, Shadows, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";

interface MessageActionSheetProps {
  visible: boolean;
  /** Only the sender of a message that still has content may delete it for everyone. */
  canDeleteForEveryone: boolean;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onClose: () => void;
}

export const MessageActionSheet: React.FC<MessageActionSheetProps> = ({
  visible,
  canDeleteForEveryone,
  onDeleteForMe,
  onDeleteForEveryone,
  onClose,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.sheet} testID="message-action-sheet">
              <Text style={styles.title}>Message options</Text>

              <TouchableOpacity
                style={styles.option}
                onPress={onDeleteForMe}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Delete for me"
                testID="message-action-delete-for-me"
              >
                <Trash2 size={18} color={Colors.foreground} />
                <View style={styles.optionTextWrap}>
                  <Text style={styles.optionText}>Delete for me</Text>
                  <Text style={styles.optionHint}>Removes it from your chat only.</Text>
                </View>
              </TouchableOpacity>

              {canDeleteForEveryone ? (
                <TouchableOpacity
                  style={styles.option}
                  onPress={onDeleteForEveryone}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Delete for everyone"
                  testID="message-action-delete-for-everyone"
                >
                  <Users size={18} color={Colors.destructive} />
                  <View style={styles.optionTextWrap}>
                    <Text style={[styles.optionText, { color: Colors.destructive }]}>
                      Delete for everyone
                    </Text>
                    <Text style={styles.optionHint}>Removes it for both of you.</Text>
                  </View>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={styles.cancel}
                onPress={onClose}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                testID="message-action-cancel"
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: Colors.overlay,
      justifyContent: "flex-end",
      padding: 16,
    },
    sheet: {
      width: "100%",
      backgroundColor: Colors.card,
      borderRadius: Radii.xxl,
      padding: 16,
      ...Shadows.card,
    },
    title: {
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
      textAlign: "center",
      marginBottom: 8,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      paddingVertical: 14,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    },
    optionTextWrap: {
      flex: 1,
    },
    optionText: {
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.medium,
      color: Colors.foreground,
    },
    optionHint: {
      fontSize: Typography.sizes.xs,
      color: Colors.mutedForeground,
      marginTop: 2,
    },
    cancel: {
      alignItems: "center",
      paddingVertical: 14,
      marginTop: 4,
    },
    cancelText: {
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.semibold,
      color: Colors.mutedForeground,
    },
  });
