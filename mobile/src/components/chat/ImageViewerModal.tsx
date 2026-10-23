import React from "react";
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StatusBar,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface ImageViewerModalProps {
  /** Image to show full screen. null keeps the viewer closed. */
  uri: string | null;
  onClose: () => void;
}

/** Full-screen photo viewer (WhatsApp style): black background, image fitted to the screen. */
export const ImageViewerModal: React.FC<ImageViewerModalProps> = ({ uri, onClose }) => {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={!!uri}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar backgroundColor="#000" barStyle="light-content" />
      <View style={styles.root} testID="image-viewer">
        {uri ? (
          <ScrollView
            style={StyleSheet.absoluteFill}
            contentContainerStyle={styles.content}
            maximumZoomScale={4}
            minimumZoomScale={1}
            bouncesZoom
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            centerContent
          >
            <Pressable onPress={onClose} accessibilityLabel="Close photo">
              <Image source={{ uri }} style={{ width, height }} contentFit="contain" />
            </Pressable>
          </ScrollView>
        ) : null}

        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + 12 }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <X size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  content: { flexGrow: 1, justifyContent: "center", alignItems: "center" },
  closeBtn: {
    position: "absolute",
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
});
