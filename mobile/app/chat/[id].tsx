import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Alert } from "../../src/utils/alert";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import {
  ArrowLeft,
  Phone,
  Video,
  MoreVertical,
  ImagePlus,
  Send,
  Sparkles,
  Trophy,
  ShieldCheck,
  Compass,
  ChevronDown,
  ChevronUp,
} from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { ChatBubble } from "../../src/components/chat/ChatBubble";
import { ProfilePhoto } from "../../src/components/profile/ProfilePhoto";
import { Dialog } from "../../src/components/ui/Dialog";
import { CoupleGamesModal } from "../../src/components/chat/CoupleGamesModal";
import { SMART_ICEBREAKERS, type Icebreaker } from "../../src/constants/icebreakers";
import { useAuth } from "../../src/context/AuthContext";
import { useMilo } from "../../src/context/MiloContext";
import {
  fetchMessagesForMatch,
  sendChatMessage,
  markChatRead,
  subscribeToMatchMessages,
} from "../../src/services/chat";
import { blockUser, reportUser, unmatchUser } from "../../src/services/moderation";
import { supabase } from "../../src/services/supabase";
import type { Message, Profile } from "../../src/types";

export default function ChatDetailScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
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

  // Smart Icebreaker & Game & Journey States
  const [showIcebreakers, setShowIcebreakers] = useState(false);
  const [icebreakerLang, setIcebreakerLang] = useState<"hinglish" | "hindi" | "english">("hinglish");
  const [showGamesModal, setShowGamesModal] = useState(false);
  const [showJourney, setShowJourney] = useState(false);

  const flatListRef = useRef<FlatList>(null);

  // Find match partner
  const matchItem = matches.find((m) => m.id === matchId);
  const otherUser: Profile = matchItem?.otherUser || {
    id: "unknown",
    name: "Match",
    age: 0,
    city: "",
    distanceKm: 0,
    bio: "",
    photos: [],
    interests: [],
    intent: "",
  };

  useEffect(() => {
    if (!matchId || !user) return;

    fetchMessagesForMatch(matchId, user.id).then((msgs) => {
      setMessages(msgs);
      markChatRead(matchId, user.id);
    });

    const channel = subscribeToMatchMessages(
      matchId,
      (newMsg) => {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
        if (newMsg.fromId !== user.id) {
          markChatRead(matchId, user.id);
        }
      },
      user.id,
    );

    return () => {
      supabase.removeChannel(channel);
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
      Alert.alert("Permission required", "Chahat needs photo permissions to share images.");
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

  const handleSelectIcebreaker = (icebreaker: Icebreaker) => {
    setInputText(icebreaker.text);
    setShowIcebreakers(false);
  };

  const handleSendGameAnswer = async (gameText: string) => {
    if (!user || !matchId) return;
    const res = await sendChatMessage(matchId, user.id, gameText);
    if (res.success && res.message) {
      setMessages((prev) => [...prev, res.message!]);
      refreshMatches();
      flatListRef.current?.scrollToEnd({ animated: true });
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
          "Thank you for helping keep Chahat safe. Our team will review this.",
        );
      } else {
        Alert.alert("Could not report", rep.error || "Please try again later.");
      }
    }

    setActionDialog(null);
  };

  const activeIcebreakers = SMART_ICEBREAKERS.filter((i) => i.category === icebreakerLang);

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
          <ProfilePhoto
            uri={otherUser.photos[0]}
            name={otherUser.name}
            style={styles.avatar}
            placeholderSize={40}
          />
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
            onPress={() => setShowGamesModal(true)}
            accessibilityLabel="Couple games"
          >
            <Trophy size={19} color={Colors.accent} />
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

      {/* Connection Journey Bar */}
      <View style={styles.journeyBar}>
        <TouchableOpacity
          style={styles.journeyHeader}
          onPress={() => setShowJourney(!showJourney)}
          activeOpacity={0.7}
        >
          <View style={styles.journeyTitleRow}>
            <Compass size={14} color={Colors.primary} />
            <Text style={styles.journeyTitle}>Connection Journey: Getting to know {otherUser.name}</Text>
          </View>
          {showJourney ? (
            <ChevronUp size={16} color={Colors.mutedForeground} />
          ) : (
            <ChevronDown size={16} color={Colors.mutedForeground} />
          )}
        </TouchableOpacity>

        {showJourney && (
          <View style={styles.journeyBody}>
            <View style={styles.journeyStep}>
              <View style={[styles.stepDot, styles.stepDotDone]} />
              <Text style={styles.stepText}>1. Matched with shared interests</Text>
            </View>
            <View style={styles.journeyStep}>
              <View style={[styles.stepDot, messages.length > 0 && styles.stepDotDone]} />
              <Text style={styles.stepText}>2. Break the ice (try Hindi/Hinglish starters)</Text>
            </View>
            <View style={styles.journeyStep}>
              <View style={[styles.stepDot, messages.length >= 6 && styles.stepDotDone]} />
              <Text style={styles.stepText}>3. Play Couple Quiz or This or That</Text>
            </View>
            <View style={styles.journeyStep}>
              <View style={styles.stepDot} />
              <Text style={styles.stepText}>4. Consensual Voice Note / Video Call & Date Plan</Text>
            </View>
          </View>
        )}
      </View>

      {/* Safety Notice Header */}
      <View style={styles.safetyNotice}>
        <ShieldCheck size={14} color={Colors.mutedForeground} />
        <Text style={styles.safetyNoticeText}>
          Keep conversations on Chahat. Never share OTP or bank details.
        </Text>
      </View>

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
              <ProfilePhoto
                uri={otherUser.photos[0]}
                name={otherUser.name}
                style={styles.emptyAvatar}
                placeholderSize={56}
              />
              <Text style={styles.emptyMatchTitle}>You matched with {otherUser.name}</Text>
              <Text style={styles.emptyMatchDesc}>
                Say hello when you're ready! Start with shared interests like{" "}
                {otherUser.interests[0] || "coffee"}.
              </Text>
              <TouchableOpacity
                style={styles.starterQuickBtn}
                onPress={() => setShowIcebreakers(true)}
              >
                <Sparkles size={16} color={Colors.primaryForeground} />
                <Text style={styles.starterQuickBtnText}>Use Smart Icebreaker</Text>
              </TouchableOpacity>
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

        {/* Smart Icebreakers Drawer */}
        {showIcebreakers && (
          <View style={styles.icebreakersDrawer}>
            <View style={styles.icebreakerHeader}>
              <View style={styles.icebreakerTabs}>
                {(["hinglish", "hindi", "english"] as const).map((lang) => (
                  <TouchableOpacity
                    key={lang}
                    style={[
                      styles.langTab,
                      icebreakerLang === lang && styles.langTabActive,
                    ]}
                    onPress={() => setIcebreakerLang(lang)}
                  >
                    <Text
                      style={[
                        styles.langTabText,
                        icebreakerLang === lang && styles.langTabTextActive,
                      ]}
                    >
                      {lang === "hinglish" ? "Hinglish 💬" : lang === "hindi" ? "हिंदी 🇮🇳" : "English ✨"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={styles.closeDrawerBtn}
                onPress={() => setShowIcebreakers(false)}
              >
                <Text style={styles.closeDrawerText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.icebreakersScroll}
            >
              {activeIcebreakers.map((ib) => (
                <TouchableOpacity
                  key={ib.id}
                  style={styles.icebreakerChip}
                  onPress={() => handleSelectIcebreaker(ib)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.icebreakerChipTag}>{ib.tag}</Text>
                  <Text style={styles.icebreakerChipText}>{ib.text}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Input Bar */}
        <View style={styles.inputBar}>
          <TouchableOpacity style={styles.attachBtn} onPress={handlePickImage} activeOpacity={0.7}>
            <ImagePlus size={22} color={Colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.attachBtn, showIcebreakers && styles.attachBtnActive]}
            onPress={() => setShowIcebreakers(!showIcebreakers)}
            activeOpacity={0.7}
          >
            <Sparkles size={20} color={showIcebreakers ? Colors.accent : Colors.mutedForeground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.attachBtn}
            onPress={() => setShowGamesModal(true)}
            activeOpacity={0.7}
          >
            <Trophy size={19} color={Colors.primary} />
          </TouchableOpacity>

          <TextInput
            style={styles.textInput}
            placeholder="Type a message or use icebreaker…"
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

      {/* Couple Games Modal */}
      <CoupleGamesModal
        visible={showGamesModal}
        partnerName={otherUser.name}
        onClose={() => setShowGamesModal(false)}
        onSendGameAnswer={handleSendGameAnswer}
      />

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

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
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
    gap: 6,
  },
  actionIcon: {
    padding: 6,
  },
  journeyBar: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  journeyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  journeyTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  journeyTitle: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  journeyBody: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 4,
  },
  journeyStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: Radii.full,
    backgroundColor: Colors.border,
  },
  stepDotDone: {
    backgroundColor: Colors.success,
  },
  stepText: {
    fontSize: Typography.sizes.xs,
    color: Colors.foreground,
  },
  safetyNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.secondary,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  safetyNoticeText: {
    fontSize: 11,
    color: Colors.mutedForeground,
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
  starterQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Radii.full,
    marginTop: 20,
  },
  starterQuickBtnText: {
    color: Colors.primaryForeground,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
  },
  imagePreviewBar: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 12,
  },
  previewThumb: {
    width: 44,
    height: 44,
    borderRadius: Radii.sm,
  },
  previewText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.foreground,
  },
  removePreview: {
    fontSize: Typography.sizes.sm,
    color: Colors.destructive,
    fontWeight: Typography.weights.medium,
  },
  icebreakersDrawer: {
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingVertical: 10,
  },
  icebreakerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  icebreakerTabs: {
    flexDirection: "row",
    gap: 8,
  },
  langTab: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radii.full,
    backgroundColor: Colors.secondary,
  },
  langTabActive: {
    backgroundColor: Colors.primary,
  },
  langTabText: {
    fontSize: Typography.sizes.xs,
    color: Colors.foreground,
    fontWeight: Typography.weights.medium,
  },
  langTabTextActive: {
    color: Colors.primaryForeground,
    fontWeight: Typography.weights.bold,
  },
  closeDrawerBtn: {
    padding: 4,
  },
  closeDrawerText: {
    fontSize: 14,
    color: Colors.mutedForeground,
  },
  icebreakersScroll: {
    paddingHorizontal: 12,
    gap: 10,
  },
  icebreakerChip: {
    backgroundColor: Colors.secondary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: Radii.lg,
    maxWidth: 240,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  icebreakerChipTag: {
    fontSize: 10,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
    marginBottom: 2,
    textTransform: "uppercase",
  },
  icebreakerChipText: {
    fontSize: Typography.sizes.xs,
    color: Colors.foreground,
    lineHeight: 16,
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
    padding: 6,
    borderRadius: Radii.full,
  },
  attachBtnActive: {
    backgroundColor: Colors.secondary,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: Colors.input,
    borderRadius: Radii.full,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: Typography.sizes.sm,
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
    backgroundColor: Colors.muted,
  },
});
