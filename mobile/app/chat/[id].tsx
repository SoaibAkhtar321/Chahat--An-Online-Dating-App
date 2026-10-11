import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Alert } from "../../src/utils/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { ArrowLeft, Phone, Video, MoreVertical, ImagePlus, Send } from "lucide-react-native";
import { Colors, Radii, Typography } from "../../src/constants/theme";
import { ChatBubble } from "../../src/components/chat/ChatBubble";
import { Dialog } from "../../src/components/ui/Dialog";
import { useAuth } from "../../src/context/AuthContext";
import { useMilo } from "../../src/context/MiloContext";
import {
  fetchMessagesForMatch,
  sendChatMessage,
  markChatRead,
  subscribeToMatchMessages,
} from "../../src/services/chat";
import { blockUser, reportUser, unmatchUser } from "../../src/services/moderation";
import { getSignedUrls } from "../../src/services/storage";
import type { Message, Profile } from "../../src/types";

export default function ChatDetailScreen() {
  const router = useRouter();
  const { id: matchId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { matches, refreshMatches } = useMilo();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [actionDialog, setActionDialog] = useState<"block" | "report" | "unmatch" | null>(null);

  const flatListRef = useRef<FlatList>(null);

  // Find match partner
  const matchItem = matches.find((m) => m.id === matchId);
  const otherUser: Profile = matchItem?.otherUser || {
    id: "unknown",
    name: "Match",
    age: 26,
    city: "Mumbai",
    distanceKm: 5,
    bio: "",
    photos: ["https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800"],
    interests: [],
    intent: "",
  };

  useEffect(() => {
    if (!matchId || !user) return;

    fetchMessagesForMatch(matchId, user.id).then(setMessages);
    markChatRead(matchId, user.id);

    const channel = subscribeToMatchMessages(
      matchId,
      async (newMsgRow) => {
        let imageUrl: string | undefined;
        if (newMsgRow.image_path) {
          imageUrl = (await getSignedUrls("chat", [newMsgRow.image_path]))[newMsgRow.image_path];
        }

      const formatted: Message = {
        id: newMsgRow.id,
        matchId: newMsgRow.match_id,
        sender: newMsgRow.sender,
        from: newMsgRow.sender === user.id ? "me" : "them",
        text: newMsgRow.body,
        image: imageUrl,
        at: new Date(newMsgRow.created_at).getTime(),
        status: newMsgRow.read_at ? "read" : "sent",
      };

      setMessages((prev) => {
        if (prev.some((m) => m.id === formatted.id)) {
          return prev.map((m) => (m.id === formatted.id ? formatted : m));
        }
        return [...prev, formatted];
      });
      markChatRead(matchId, user.id);
    }, user.id);

    return () => {
      channel.unsubscribe();
    };
  }, [matchId, user]);

  const handleSend = async () => {
    const text = inputText.trim();
    if ((!text && !selectedImageUri) || !user || !matchId) return;

    setSending(true);
    const img = selectedImageUri || undefined;
    setSelectedImageUri(null);
    setInputText("");

    const res = await sendChatMessage(matchId, user.id, text, img);
    setSending(false);

    if (res.success && res.message) {
      setMessages((prev) => [...prev, res.message!]);
      refreshMatches();
      flatListRef.current?.scrollToEnd({ animated: true });
    } else {
      Alert.alert("Error", res.error || "Could not send message");
    }
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Milo needs photo permissions to share images.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      setSelectedImageUri(result.assets[0].uri);
    }
  };

  const handleConfirmAction = async () => {
    if (!actionDialog) return;

    if (actionDialog === "block") {
      await blockUser(otherUser.id);
      Alert.alert("Blocked", `You have blocked ${otherUser.name}.`);
      refreshMatches();
      router.back();
    } else if (actionDialog === "unmatch") {
      await unmatchUser(matchId);
      Alert.alert("Unmatched", `You have unmatched with ${otherUser.name}.`);
      refreshMatches();
      router.back();
    } else if (actionDialog === "report") {
      const rep = await reportUser(otherUser.id, "Inappropriate behavior", "Reported from mobile chat", "chat");
      if (rep.success) {
        Alert.alert(
          "Report submitted",
          "Thank you for helping keep Milo safe. Our team will review this.",
        );
      } else {
        Alert.alert("Could not report", rep.error || "Please try again later.");
      }
    }

    setActionDialog(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <ArrowLeft size={22} color={Colors.foreground} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.partnerInfo}
          onPress={() =>
            router.push({
              pathname: "/profile/[id]",
              params: { id: otherUser.id },
            })
          }
          activeOpacity={0.8}
        >
          <Image source={{ uri: otherUser.photos[0] }} style={styles.avatar} contentFit="cover" />
          <View>
            <Text style={styles.partnerName} numberOfLines={1}>
              {otherUser.name}
            </Text>
            <Text style={styles.partnerStatus}>Active recently</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.actionIcon}
            onPress={() =>
              router.push({
                pathname: "/call/[id]",
                params: { id: otherUser.id },
              })
            }
          >
            <Phone size={18} color={Colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionIcon}
            onPress={() =>
              router.push({
                pathname: "/call/[id]",
                params: { id: otherUser.id },
              })
            }
          >
            <Video size={20} color={Colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionIcon} onPress={() => setMenuVisible(!menuVisible)}>
            <MoreVertical size={20} color={Colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Menu dropdown banner */}
      {menuVisible && (
        <View style={styles.menuBanner}>
          <TouchableOpacity
            style={styles.menuOption}
            onPress={() => {
              setMenuVisible(false);
              setActionDialog("report");
            }}
          >
            <Text style={styles.menuOptionText}>Report user</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuOption}
            onPress={() => {
              setMenuVisible(false);
              setActionDialog("block");
            }}
          >
            <Text style={styles.menuOptionText}>Block user</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuOption}
            onPress={() => {
              setMenuVisible(false);
              setActionDialog("unmatch");
            }}
          >
            <Text style={[styles.menuOptionText, { color: Colors.destructive }]}>Unmatch</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Message List */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.chatArea}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <ChatBubble
              message={item}
              showDayHeader={
                index === 0 ||
                new Date(messages[index - 1]!.at).toDateString() !==
                  new Date(item.at).toDateString()
              }
            />
          )}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyMessages}>
              <Image source={{ uri: otherUser.photos[0] }} style={styles.emptyAvatar} />
              <Text style={styles.emptyMatchTitle}>You matched with {otherUser.name}</Text>
              <Text style={styles.emptyMatchDesc}>
                Say hello when you're ready! Start with shared interests like{" "}
                {otherUser.interests[0] || "coffee"}.
              </Text>
            </View>
          }
        />

        {/* Selected image preview */}
        {selectedImageUri && (
          <View style={styles.imagePreviewBar}>
            <Image source={{ uri: selectedImageUri }} style={styles.previewThumb} />
            <Text style={styles.previewText}>Photo ready to send</Text>
            <TouchableOpacity onPress={() => setSelectedImageUri(null)}>
              <Text style={styles.removePreview}>Remove</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Input Bar */}
        <View style={styles.inputBar}>
          <TouchableOpacity style={styles.attachBtn} onPress={handlePickImage} activeOpacity={0.7}>
            <ImagePlus size={22} color={Colors.primary} />
          </TouchableOpacity>

          <TextInput
            style={styles.textInput}
            placeholder="Type a message…"
            placeholderTextColor={Colors.mutedForeground}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={1000}
          />

          <TouchableOpacity
            style={[
              styles.sendBtn,
              !inputText.trim() && !selectedImageUri && styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={(!inputText.trim() && !selectedImageUri) || sending}
            activeOpacity={0.8}
          >
            <Send size={18} color={Colors.primaryForeground} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Action Dialogs */}
      <Dialog
        visible={actionDialog !== null}
        title={
          actionDialog === "block"
            ? `Block ${otherUser.name}?`
            : actionDialog === "unmatch"
              ? `Unmatch with ${otherUser.name}?`
              : `Report ${otherUser.name}`
        }
        body={
          actionDialog === "block"
            ? "They won't be able to view your profile, and your conversation will be deleted."
            : actionDialog === "unmatch"
              ? "This will remove them from your matches and delete your chat history."
              : "Please report inappropriate content, harassment, fake profiles, or safety issues."
        }
        confirmText={
          actionDialog === "block"
            ? "Block"
            : actionDialog === "unmatch"
              ? "Unmatch"
              : "Submit Report"
        }
        danger={actionDialog === "block" || actionDialog === "unmatch"}
        onConfirm={handleConfirmAction}
        onCancel={() => setActionDialog(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
    gap: 8,
  },
  backBtn: {
    padding: 6,
  },
  partnerInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
  },
  partnerName: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  partnerStatus: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionIcon: {
    padding: 6,
  },
  menuBanner: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: 4,
    zIndex: 10,
  },
  menuOption: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  menuOptionText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.medium,
    color: Colors.foreground,
  },
  chatArea: {
    flex: 1,
  },
  messageList: {
    paddingVertical: 16,
    flexGrow: 1,
  },
  emptyMessages: {
    alignItems: "center",
    padding: 32,
    marginTop: 40,
  },
  emptyAvatar: {
    width: 80,
    height: 80,
    borderRadius: Radii.full,
    marginBottom: 16,
  },
  emptyMatchTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
  },
  emptyMatchDesc: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  imagePreviewBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 10,
  },
  previewThumb: {
    width: 40,
    height: 40,
    borderRadius: Radii.sm,
  },
  previewText: {
    flex: 1,
    fontSize: Typography.sizes.xs,
    color: Colors.foreground,
  },
  removePreview: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.destructive,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 8,
  },
  attachBtn: {
    padding: 8,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: Colors.background,
    borderRadius: Radii.xl,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: Typography.sizes.base,
    color: Colors.foreground,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
