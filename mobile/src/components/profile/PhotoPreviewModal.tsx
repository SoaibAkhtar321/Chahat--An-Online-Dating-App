import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import { X, Crop, RotateCcw } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { centerCropRect } from "../../utils/cropMath";
import { Alert } from "../../utils/alert";

export interface PickedPhoto {
  uri: string;
  width?: number;
  height?: number;
}

interface Props {
  photo: PickedPhoto | null;
  onDone: (photo: PickedPhoto) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Review step after picking a photo. Done (top right) confirms the photo as it is; Crop (bottom
 * toolbar) is an optional action that center-crops to the 3:4 profile format and can be undone.
 * Hardware/gesture back cancels, same as the X button.
 */
export const PhotoPreviewModal: React.FC<Props> = ({ photo, onDone, onCancel }) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const [cropped, setCropped] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    setCropped(null);
    busyRef.current = false;
    setBusy(false);
  }, [photo?.uri]);

  if (!photo) return null;
  const current = cropped ?? photo;

  const run = async (fn: () => Promise<void>) => {
    if (busyRef.current) return; // blocks double taps / duplicate uploads
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleCrop = () =>
    run(async () => {
      const { width, height } = photo;
      if (!width || !height) {
        Alert.alert("Can't crop this photo", "Its size couldn't be read. You can still use it as it is.");
        return;
      }
      try {
        const rect = centerCropRect(width, height);
        const out = await ImageManipulator.manipulateAsync(photo.uri, [{ crop: rect }], {
          compress: 1,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        setCropped({ uri: out.uri, width: out.width, height: out.height });
      } catch {
        Alert.alert("Couldn't crop", "Something went wrong cropping this photo. You can still use it as it is.");
      }
    });

  const handleDone = () => run(async () => void (await onDone(current)));

  return (
    <Modal visible animationType="slide" onRequestClose={() => !busyRef.current && onCancel()}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onCancel}
            disabled={busy}
            style={styles.iconBtn}
            accessibilityLabel="Cancel"
            testID="photo-cancel"
          >
            <X size={24} color={Colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>Preview</Text>
          <TouchableOpacity
            onPress={handleDone}
            disabled={busy}
            accessibilityLabel="Done"
            testID="photo-done"
          >
            {busy ? (
              <ActivityIndicator color={Colors.primary} />
            ) : (
              <Text style={styles.done}>Done</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.imageWrap}>
          <Image source={{ uri: current.uri }} style={styles.image} contentFit="contain" />
        </View>

        <View style={styles.toolbar}>
          {cropped ? (
            <TouchableOpacity
              style={styles.tool}
              onPress={() => setCropped(null)}
              disabled={busy}
              accessibilityLabel="Undo crop"
              testID="photo-undo-crop"
            >
              <RotateCcw size={20} color={Colors.foreground} />
              <Text style={styles.toolText}>Undo crop</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.tool}
              onPress={handleCrop}
              disabled={busy}
              accessibilityLabel="Crop"
              testID="photo-crop"
            >
              <Crop size={20} color={Colors.foreground} />
              <Text style={styles.toolText}>Crop to 3:4</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    header: {
      height: 56,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
    },
    iconBtn: { padding: 4 },
    title: { fontSize: Typography.sizes.lg, fontWeight: Typography.weights.bold, color: Colors.foreground },
    done: { fontSize: Typography.sizes.base, fontWeight: Typography.weights.bold, color: Colors.primary },
    imageWrap: { flex: 1, backgroundColor: Colors.ink, justifyContent: "center" },
    image: { width: "100%", height: "100%" },
    toolbar: {
      flexDirection: "row",
      justifyContent: "center",
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: Colors.border,
      backgroundColor: Colors.card,
    },
    tool: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: Radii.full,
      backgroundColor: Colors.secondary,
    },
    toolText: { color: Colors.foreground, fontWeight: Typography.weights.semibold },
  });
