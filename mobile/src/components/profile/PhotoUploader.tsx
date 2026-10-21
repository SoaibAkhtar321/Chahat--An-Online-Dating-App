import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions, Platform } from "react-native";
import { Alert } from "../../utils/alert";
import * as ImagePicker from "expo-image-picker";
import { Plus, X, Star, ArrowLeft, ArrowRight } from "lucide-react-native";
import { Radii, Typography, ThemeColors, Spacing } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import type { PhotoItem } from "../../types";
import { compressToUnderLimit } from "../../utils/compressImage";
import { ProfilePhoto } from "./ProfilePhoto";
import { hasSelectedPhotoUri } from "../../services/profilePolicy";
import { PhotoPreviewModal, type PickedPhoto } from "./PhotoPreviewModal";

const { width } = Dimensions.get("window");
const ITEM_WIDTH = (width - 64) / 3;

interface PhotoUploaderProps {
  photos: PhotoItem[];
  onChange: (photos: PhotoItem[]) => void;
  maxPhotos?: number;
}

export const PhotoUploader: React.FC<PhotoUploaderProps> = ({
  photos,
  onChange,
  maxPhotos = 4,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const busyRef = useRef(false);
  // A picked photo waits here for the Done/Crop review. The target slot is fixed at pick time so a
  // later change to the list can never put the photo in the wrong place.
  const [pending, setPending] = useState<{ photo: PickedPhoto; index: number; originalUri: string } | null>(null);

  // Compresses the picked image to under 1 MB, then adds it to the list.
  const addPhoto = async (
    asset: { uri: string; width?: number },
    index: number,
    originalUri: string = asset.uri,
  ) => {
    if (hasSelectedPhotoUri(photosRef.current, originalUri)) return;
    const compressedUri = await compressToUnderLimit(asset.uri, asset.width);
    const current = photosRef.current;
    const newPhoto: PhotoItem = {
      id: `photo_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      uri: compressedUri,
      sourceUri: originalUri,
      status: "pending",
      isMain: index === 0,
    };
    const updated = [...current];
    if (index < updated.length) {
      updated[index] = newPhoto;
    } else if (updated.length < maxPhotos) {
      updated.push(newPhoto);
    }
    onChange(updated);
  };

  // Android can destroy the activity while the system picker is open; the result is then only
  // available through getPendingResultAsync after the app comes back.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    let cancelled = false;
    (async () => {
      try {
        const pending = await ImagePicker.getPendingResultAsync();
        if (cancelled || !Array.isArray(pending)) return;
        for (const item of pending) {
          if ("canceled" in item && !item.canceled && item.assets?.[0]?.uri) {
            await addPhoto(item.assets[0], photosRef.current.length);
            break;
          }
        }
      } catch (e) {
        console.warn("PhotoUploader: pending result check failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickImage = async (index: number) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission required",
          "Chahat needs photo permissions to upload profile pictures.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        // No system editor: its top-right "Crop" acted as Done. Review happens in PhotoPreviewModal.
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) {
        Alert.alert(
          "Photo not added",
          "The selected photo could not be read. Please try another one.",
        );
        return;
      }

      if (hasSelectedPhotoUri(photosRef.current, asset.uri)) return;
      setPending({
        photo: { uri: asset.uri, width: asset.width, height: asset.height },
        index,
        originalUri: asset.uri,
      });
    } catch (err: any) {
      console.error("PhotoUploader: pickImage failed", err);
      Alert.alert(
        "Could not add photo",
        err?.message || "Something went wrong while selecting the photo.",
      );
    } finally {
      busyRef.current = false;
    }
  };

  const removePhoto = (index: number) => {
    const updated = photos.filter((_, i) => i !== index);
    onChange(updated);
  };

  const movePhoto = (from: number, to: number) => {
    if (to < 0 || to >= photos.length) return;
    const updated = [...photos];
    const [moved] = updated.splice(from, 1);
    if (moved) {
      updated.splice(to, 0, moved);
      onChange(updated);
    }
  };

  const confirmPending = async (final: PickedPhoto) => {
    const target = pending;
    if (!target) return;
    try {
      await addPhoto(final, target.index, target.originalUri);
      setPending(null);
    } catch (err: any) {
      Alert.alert("Could not add photo", err?.message || "Something went wrong while preparing the photo.");
    }
  };

  const slots = Array.from({ length: maxPhotos }, (_, i) => photos[i] || null);

  return (
    <View style={styles.grid}>
      <PhotoPreviewModal photo={pending?.photo ?? null} onDone={confirmPending} onCancel={() => setPending(null)} />
      {slots.map((item, index) => (
        <View key={index} style={styles.slot}>
          {item ? (
            <View style={styles.photoContainer}>
              <ProfilePhoto
                uri={item.uri}
                name="Selected photo"
                style={styles.image}
                imageStyle={styles.image}
                placeholderSize={40}
              />

              {/* Star badge for main photo */}
              {index === 0 && (
                <View style={styles.starBadge}>
                  <Star
                    size={12}
                    color={Colors.primaryForeground}
                    fill={Colors.primaryForeground}
                  />
                </View>
              )}

              {/* Status indicator */}
              <View
                style={[
                  styles.statusBadge,
                  item.status === "approved" ? styles.statusApproved : styles.statusPending,
                ]}
              >
                <Text style={styles.statusText}>
                  {item.status === "approved" ? "Live" : "Review"}
                </Text>
              </View>

              {/* Delete button */}
              <TouchableOpacity
                onPress={() => removePhoto(index)}
                style={styles.deleteButton}
                activeOpacity={0.8}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove photo ${index + 1}`}
              >
                <X size={12} color={Colors.primaryForeground} />
              </TouchableOpacity>

              {/* Reorder controls */}
              <View style={styles.reorderRow}>
                {index > 0 && (
                  <TouchableOpacity
                    onPress={() => movePhoto(index, index - 1)}
                    style={styles.arrowButton}
                    hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Move photo ${index + 1} earlier`}
                  >
                    <ArrowLeft size={10} color={Colors.primaryForeground} />
                  </TouchableOpacity>
                )}
                {index < photos.length - 1 && (
                  <TouchableOpacity
                    onPress={() => movePhoto(index, index + 1)}
                    style={styles.arrowButton}
                    hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Move photo ${index + 1} later`}
                  >
                    <ArrowRight size={10} color={Colors.primaryForeground} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => pickImage(index)}
              style={styles.emptySlot}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Add photo ${index + 1}`}
            >
              <Plus size={24} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
};

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginVertical: Spacing.md,
  },
  slot: {
    width: ITEM_WIDTH,
    height: ITEM_WIDTH * 1.33,
    borderRadius: Radii.lg,
    overflow: "hidden",
  },
  photoContainer: {
    width: "100%",
    height: "100%",
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
    borderRadius: Radii.lg,
  },
  emptySlot: {
    width: "100%",
    height: "100%",
    borderRadius: Radii.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: "dashed",
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  starBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: Colors.primary,
    padding: Spacing.xs,
    borderRadius: Radii.full,
  },
  statusBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: 4,
  },
  statusApproved: {
    backgroundColor: Colors.success,
  },
  statusPending: {
    backgroundColor: Colors.accent,
  },
  statusText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  deleteButton: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: Radii.full,
    backgroundColor: Colors.destructive,
    alignItems: "center",
    justifyContent: "center",
  },
  reorderRow: {
    position: "absolute",
    bottom: 6,
    right: 6,
    flexDirection: "row",
    gap: Spacing.xs,
  },
  arrowButton: {
    backgroundColor: "rgba(35, 20, 30, 0.7)",
    padding: Spacing.xs,
    borderRadius: 4,
  },
});
