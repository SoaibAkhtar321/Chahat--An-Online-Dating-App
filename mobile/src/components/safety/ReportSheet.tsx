// Report a member: pick a reason (and optionally add details). The reason is stored as the report category so the
// moderation team can prioritise (e.g. "Appears to be under 18" and threats first). Google Play's User Generated
// Content and Child Safety Standards policies require a clear in-app way to report users and content.
import React, { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Check } from "lucide-react-native";
import { useTheme } from "../../context/ThemeContext";
import { Layout, Radii, Spacing, ThemeColors, Typography } from "../../constants/theme";

export const REPORT_REASONS = [
  "Appears to be under 18",
  "Harassment or threats",
  "Sexual or inappropriate content",
  "Fake profile or impersonation",
  "Scam, spam or asking for money",
  "Hate speech or discrimination",
  "Something else",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_NOTE_MAX = 500;

interface Props {
  visible: boolean;
  name: string;
  submitting?: boolean;
  onSubmit: (reason: ReportReason, note: string) => void;
  onCancel: () => void;
}

export function ReportSheet({ visible, name, submitting = false, onSubmit, onCancel }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");

  const close = () => {
    setReason(null);
    setNote("");
    onCancel();
  };
  const submit = () => {
    if (!reason || submitting) return;
    onSubmit(reason, note.trim().slice(0, REPORT_NOTE_MAX));
    setReason(null);
    setNote("");
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close report" />
      <View style={styles.sheet}>
        <Text style={styles.title}>Report {name}</Text>
        <Text style={styles.subtitle}>Why are you reporting? {name} won't know who reported them.</Text>
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {REPORT_REASONS.map((r) => (
            <TouchableOpacity
              key={r}
              style={styles.reason}
              onPress={() => setReason(r)}
              accessibilityRole="radio"
              accessibilityState={{ selected: reason === r }}
              testID={`report-reason-${r}`}
            >
              <Text style={styles.reasonText}>{r}</Text>
              {reason === r ? <Check size={18} color={colors.primary} /> : null}
            </TouchableOpacity>
          ))}
          <TextInput
            style={styles.note}
            value={note}
            onChangeText={setNote}
            placeholder="Add details (optional)"
            placeholderTextColor={colors.mutedForeground}
            maxLength={REPORT_NOTE_MAX}
            multiline
            textAlignVertical="top"
          />
          {reason === "Appears to be under 18" ? (
            <Text style={styles.urgent}>
              Thank you. Reports about minors are reviewed first. If a child is in danger, also call 112 or report at
              cybercrime.gov.in.
            </Text>
          ) : null}
        </ScrollView>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancel} onPress={close} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submit, (!reason || submitting) && styles.disabled]}
            onPress={submit}
            disabled={!reason || submitting}
            accessibilityRole="button"
            testID="report-submit"
          >
            <Text style={styles.submitText}>{submitting ? "Sending…" : "Submit report"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: Colors.overlay },
    sheet: {
      backgroundColor: Colors.card,
      borderTopLeftRadius: Radii.xl,
      borderTopRightRadius: Radii.xl,
      padding: Spacing.xl,
      maxHeight: "85%",
    },
    title: { fontSize: Typography.sizes.lg, fontWeight: Typography.weights.bold, color: Colors.foreground },
    subtitle: { fontSize: Typography.sizes.sm, color: Colors.mutedForeground, marginTop: 4, marginBottom: Spacing.md },
    list: { flexGrow: 0 },
    reason: {
      minHeight: Layout.minTap,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: Colors.border,
    },
    reasonText: { fontSize: Typography.sizes.base, color: Colors.foreground, flex: 1 },
    note: {
      marginTop: Spacing.md,
      minHeight: 80,
      borderWidth: 1,
      borderColor: Colors.border,
      borderRadius: Radii.md,
      padding: Spacing.md,
      color: Colors.foreground,
      fontSize: Typography.sizes.sm,
    },
    urgent: { marginTop: Spacing.md, color: Colors.destructive, fontSize: Typography.sizes.sm, lineHeight: 20 },
    actions: { flexDirection: "row", justifyContent: "flex-end", gap: Spacing.md, marginTop: Spacing.lg },
    cancel: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg },
    cancelText: { color: Colors.mutedForeground, fontSize: Typography.sizes.base },
    submit: {
      backgroundColor: Colors.destructive,
      borderRadius: Radii.full,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.xl,
    },
    disabled: { opacity: 0.5 },
    submitText: { color: Colors.primaryForeground, fontSize: Typography.sizes.base, fontWeight: Typography.weights.semibold },
  });
