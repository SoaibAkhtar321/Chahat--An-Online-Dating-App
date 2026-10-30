// Sponsored card shown in Discover between profiles. Always labelled "Sponsored" (Google Play Ads policy: ads must
// be clearly distinguishable from app content). Swiping either way, or "Skip", moves on; nothing is liked.
import React, { useEffect, useMemo } from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Image } from "expo-image";
import { ExternalLink } from "lucide-react-native";
import { useTheme } from "../../context/ThemeContext";
import { Radii, Spacing, ThemeColors, Typography } from "../../constants/theme";
import { recordAdEvent, type DiscoverAd } from "../../services/adminContent";

export function AdCard({ ad }: { ad: DiscoverAd }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  useEffect(() => {
    recordAdEvent(ad.id, "impression");
  }, [ad.id]);

  const open = () => {
    if (!ad.ctaUrl) return;
    recordAdEvent(ad.id, "click");
    void Linking.openURL(ad.ctaUrl).catch(() => undefined);
  };

  return (
    <View style={styles.card} testID="discover-ad-card">
      {ad.imageUrl ? (
        <Image source={{ uri: ad.imageUrl }} style={styles.image} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder]} />
      )}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>Sponsored</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.advertiser} numberOfLines={1}>
          {ad.advertiser}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {ad.title}
        </Text>
        {ad.body ? (
          <Text style={styles.body} numberOfLines={3}>
            {ad.body}
          </Text>
        ) : null}
        {ad.ctaUrl ? (
          <TouchableOpacity style={styles.cta} onPress={open} accessibilityRole="link" testID="discover-ad-cta">
            <Text style={styles.ctaText}>{ad.ctaLabel}</Text>
            <ExternalLink size={16} color={colors.primaryForeground} />
          </TouchableOpacity>
        ) : null}
        <Text style={styles.hint}>Swipe or tap ✕ to continue</Text>
      </View>
    </View>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    card: { flex: 1, borderRadius: Radii.xl, overflow: "hidden", backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
    image: { width: "100%", flex: 1 },
    imagePlaceholder: { backgroundColor: Colors.secondary },
    badge: {
      position: "absolute",
      top: Spacing.md,
      left: Spacing.md,
      backgroundColor: Colors.overlay,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 4,
      borderRadius: Radii.full,
    },
    badgeText: { color: Colors.primaryForeground, fontSize: Typography.sizes.xs, fontWeight: Typography.weights.bold },
    info: { padding: Spacing.lg, gap: Spacing.xs },
    advertiser: { color: Colors.mutedForeground, fontSize: Typography.sizes.xs, fontWeight: Typography.weights.semibold },
    title: { color: Colors.foreground, fontSize: Typography.sizes.lg, fontWeight: Typography.weights.bold },
    body: { color: Colors.mutedForeground, fontSize: Typography.sizes.sm, lineHeight: 20 },
    cta: {
      marginTop: Spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.sm,
      backgroundColor: Colors.primary,
      borderRadius: Radii.full,
      paddingVertical: Spacing.md,
    },
    ctaText: { color: Colors.primaryForeground, fontSize: Typography.sizes.base, fontWeight: Typography.weights.semibold },
    hint: { color: Colors.mutedForeground, fontSize: Typography.sizes.xs, textAlign: "center", marginTop: Spacing.xs },
  });
