import React, { useMemo } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from "react-native";
import { Reply, Trash2, Users } from "lucide-react-native";
import { Radii, Shadows, Typography, ThemeColors, Spacing } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { REACTION_EMOJIS } from "../../utils/reactions";

interface MessageActionSheetProps {
  visible: boolean;
  /** Only the sender of a message that still has content may delete it for everyone. */
  canDeleteForEveryone: boolean;
  /** Quick reactions row. Hidden for a message that was deleted for everyone. */
  canReact?: boolean;
  /** The current user's reaction on this message, highlighted in the row. */
  currentReaction?: string | null;
  onReact?: (emoji: string) => void;
  /** Reply to this message. Hidden for a message that was deleted for everyone. */
  canReply?: boolean;
  onReply?: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onClose: () => void;
}

export const MessageActionSheet: React.FC<MessageActionSheetProps> = ({
  visible,
  canDeleteForEveryone,
  canReact = false,
  currentReaction = null,
  onReact,
  canReply = false,
  onReply,
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

              {canReact && onReact ? (
                <View style={styles.reactionPicker} testID="message-reaction-picker">
                  {REACTION_EMOJIS.map((emoji) => (
                    <TouchableOpacity
                      key={emoji}
                      style={[styles.reactionButton, currentReaction === emoji && styles.reactionButtonActive]}
                      onPress={() => onReact(emoji)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={currentReaction === emoji ? `Remove ${emoji} reaction` : `React ${emoji}`}
                      testID={`message-react-${emoji}`}
                    >
                      <Text style={styles.reactionButtonText}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}

              {canReply && onReply ? (
                <TouchableOpacity
                  style={styles.option}
                  onPress={onReply}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Reply"
                  testID="message-action-reply"
                >
                  <Reply size={18} color={Colors.foreground} />
                  <View style={styles.optionTextWrap}>
                    <Text style={styles.optionText}>Reply</Text>
                    <Text style={styles.optionHint}>Quote this message in your answer.</Text>
                  </View>
                </TouchableOpacity>
              ) : null}

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
      padding: Spacing.lg,
    },
    sheet: {
      width: "100%",
      backgroundColor: Colors.card,
      borderRadius: Radii.xxl,
      padding: Spacing.lg,
      ...Shadows.card,
    },
    title: {
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
      textAlign: "center",
      marginBottom: Spacing.sm,
    },
    reactionPicker: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    },
    reactionButton: {
      width: 44,
      height: 44,
      borderRadius: Radii.full,
      alignItems: "center",
      justifyContent: "center",
    },
    reactionButtonActive: {
      backgroundColor: Colors.muted,
      borderWidth: 1,
      borderColor: Colors.primary,
    },
    reactionButtonText: {
      fontSize: Typography.sizes.xxl,
    },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.lg,
      paddingVertical: Spacing.lg,
      paddingHorizontal: Spacing.sm,
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
      marginTop: Spacing.xs,
    },
    cancel: {
      alignItems: "center",
      paddingVertical: Spacing.lg,
      marginTop: Spacing.xs,
    },
    cancelText: {
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.semibold,
      color: Colors.mutedForeground,
    },
  });
