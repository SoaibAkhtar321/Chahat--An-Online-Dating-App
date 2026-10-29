// Bottom sheet with the three share options: copy link, WhatsApp, and "More" (Android share sheet: Instagram,
// Telegram, SMS, Gmail, …).
import React, { useMemo } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, ToastAndroid, TouchableOpacity, View } from "react-native";
import { Link2, Share2, X } from "lucide-react-native";
// WhatsApp's own icon (from the Font Awesome brand set), in WhatsApp green, as WhatsApp's brand guidelines ask for
// share buttons: unmodified, and only to mean "share to WhatsApp".
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useTheme } from "../../context/ThemeContext";
import { Radii, Spacing, ThemeColors, Typography, Layout } from "../../constants/theme";
import { Alert } from "../../utils/alert";
import { buildProfileShareUrl, shareProfile, type ShareChannel } from "../../services/profileShare";

interface Props {
  visible: boolean;
  profileId: string;
  isOwnProfile: boolean;
  onClose: () => void;
}

export function ShareProfileSheet({ visible, profileId, isOwnProfile, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  let url = "";
  try {
    url = buildProfileShareUrl(profileId);
  } catch {
    url = "";
  }

  const run = async (channel: ShareChannel) => {
    const res = await shareProfile(profileId, channel, { isOwnProfile });
    onClose();
    if (res.ok && channel === "copy") {
      // A short toast, like other apps, instead of a dialog that has to be dismissed.
      if (Platform.OS === "android") ToastAndroid.show("Link copied", ToastAndroid.SHORT);
      else Alert.alert("Link copied");
    } else if (!res.ok && res.reason === "unavailable") {
      Alert.alert("WhatsApp not available", "Use “More options” to share another way.");
    } else if (!res.ok && res.reason === "error") {
      Alert.alert("Could not share", "Please try again.");
    }
  };

  const WHATSAPP_GREEN = "#25D366";
  const options: { key: ShareChannel; label: string; icon: React.ReactNode }[] = [
    { key: "copy", label: "Copy link", icon: <Link2 size={22} color={colors.primary} /> },
    {
      key: "whatsapp",
      label: "WhatsApp",
      icon: <FontAwesome name="whatsapp" size={26} color={WHATSAPP_GREEN} testID="whatsapp-icon" />,
    },
    { key: "system", label: "More options", icon: <Share2 size={22} color={colors.primary} /> },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close share options" />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>{isOwnProfile ? "Share your profile" : "Share profile"}</Text>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <X size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
        {url ? (
          <Text style={styles.url} numberOfLines={1} selectable>
            {url}
          </Text>
        ) : null}
        <View style={styles.row}>
          {options.map(({ key, label, icon }) => (
            <TouchableOpacity
              key={key}
              style={styles.option}
              onPress={() => void run(key)}
              accessibilityRole="button"
              accessibilityLabel={label}
              disabled={!url}
            >
              <View style={styles.iconCircle}>
                {icon}
              </View>
              <Text style={styles.optionLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.note}>
          The link only opens inside Chahat for signed-in members. People without the app see an install page, not
          the profile.
        </Text>
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
      paddingBottom: Spacing.xl * 1.5,
    },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: {
      fontSize: Typography.sizes.lg,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
    },
    close: { minWidth: Layout.minTap, minHeight: Layout.minTap, alignItems: "flex-end", justifyContent: "center" },
    url: { fontSize: Typography.sizes.xs, color: Colors.mutedForeground, marginBottom: Spacing.lg },
    row: { flexDirection: "row", justifyContent: "space-around" },
    option: { alignItems: "center", gap: Spacing.sm, minWidth: 80, paddingVertical: Spacing.sm },
    iconCircle: {
      width: 52,
      height: 52,
      borderRadius: Radii.full,
      backgroundColor: Colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    optionLabel: { fontSize: Typography.sizes.sm, color: Colors.foreground },
    note: { fontSize: Typography.sizes.xs, color: Colors.mutedForeground, marginTop: Spacing.lg, lineHeight: 16 },
  });
