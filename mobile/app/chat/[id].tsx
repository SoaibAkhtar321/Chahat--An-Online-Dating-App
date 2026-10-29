import React, { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { safeBack } from "../../src/utils/navigation";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { Alert } from "../../src/utils/alert";
import { startVideoCallIfAllowed } from "../../src/services/callAllowanceGate";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { clearActiveConversation, setActiveConversation } from "../../src/services/activeConversation";
import { useScreenProtection } from "../../src/hooks/useScreenProtection";
import { ChatTextInput } from "../../src/components/chat/ChatTextInput";
import { isServiceConfigured } from "../../src/config/appConfig";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import {
  ArrowLeft,
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
  Mic,
  Trash2,
  X,
} from "lucide-react-native";
import { Radii, Typography, ThemeColors, Layout, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { ChatBubble } from "../../src/components/chat/ChatBubble";
import { MessageActionSheet } from "../../src/components/chat/MessageActionSheet";
import { ProfilePhoto } from "../../src/components/profile/ProfilePhoto";
import { Dialog } from "../../src/components/ui/Dialog";
import { CoupleGamesModal } from "../../src/components/chat/CoupleGamesModal";
import { ImageViewerModal } from "../../src/components/chat/ImageViewerModal";
import { SMART_ICEBREAKERS, type Icebreaker } from "../../src/constants/icebreakers";
import { useAuth } from "../../src/context/AuthContext";
import { useMilo } from "../../src/context/MiloContext";
import {
  fetchMessagesForMatch,
  sendChatMessage,
  sendVoiceMessage,
  markChatRead,
  fetchMessageReceipts,
  fetchReactionsForMatch,
  setMessageReaction,
  subscribeToMatchMessages,
} from "../../src/services/chat";
import {
  canDeleteForEveryone as canDeleteMessageForEveryone,
  canDeleteForMe,
  deleteMessage,
  type DeleteScope,
} from "../../src/services/messageDeletion";
import {
  applyTombstone,
  appendIncoming,
  mergeReceipts,
  insertChronologically,
  reconcileFetched,
  removeMessage,
  tombstoneMessage,
} from "../../src/utils/messageState";
import {
  cleanupAbandonedVoiceFile,
  getAudioPlayerAdapter,
  getAudioRecorderAdapter,
  VOICE_LIMITS,
} from "../../src/services/voiceMedia";
import { blockUser, reportUser, unmatchUser } from "../../src/services/moderation";
import { supabase } from "../../src/services/supabase";
import { joinChatPresence, type ChatPresence } from "../../src/services/chatPresence";
import { presenceLabel } from "../../src/utils/typingState";
import {
  applyReactionRow,
  buildReactionMap,
  clearMessageReactions,
  nextReaction,
  summarizeReactions,
  type ReactionMap,
} from "../../src/utils/reactions";
import {
  buildReplyPreview,
  canReplyTo,
  isReplyUnavailable,
  mergeReplyPreviews,
  REPLY_TARGET_UNAVAILABLE,
  replyAuthorLabel,
  replySnippet,
} from "../../src/utils/replies";
import type { Message, Profile } from "../../src/types";

export default function ChatDetailScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { id: matchId } = useLocalSearchParams<{ id: string }>();
  // Off unless EXPO_PUBLIC_FEATURE_VOICE_MESSAGES is exactly "true" (development/test builds only).
  const voiceEnabled = isServiceConfigured("voiceMessages");
  const { user } = useAuth();
  const { matches, refreshMatches } = useMilo();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const presenceRef = useRef<ChatPresence | null>(null);
  // Emoji reactions: messageId -> (userId -> emoji). Loaded with the thread, kept live through Realtime.
  const [reactions, setReactions] = useState<ReactionMap>({});
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  // Photo opened full screen from a chat bubble.
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  // The message the next send replies to (shown as a bar above the input).
  const [replyDraft, setReplyDraft] = useState<Message | null>(null);
  const [sending, setSending] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [actionDialog, setActionDialog] = useState<"block" | "report" | "unmatch" | null>(null);

  // Message deletion: long-press sheet, then (for "Delete for everyone") a confirmation dialog.
  const [actionTarget, setActionTarget] = useState<Message | null>(null);
  const [confirmEveryone, setConfirmEveryone] = useState<Message | null>(null);
  // Ids the user deleted for themselves; a stale fetch or late event must never bring them back.
  const hiddenIdsRef = useRef<Set<string>>(new Set());
  // id -> deletedAt for messages deleted for everyone; a stale fetch must never show their old content.
  const tombstonesRef = useRef<Map<string, string>>(new Map());
  // Tombstones the server has confirmed (RPC success or Realtime UPDATE); these are never rolled back.
  const confirmedTombstonesRef = useRef<Set<string>>(new Set());
  const inFlightDeletesRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<Message[]>([]);

  // Smart Icebreaker & Game & Journey States
  const [showIcebreakers, setShowIcebreakers] = useState(false);
  const [icebreakerLang, setIcebreakerLang] = useState<"hinglish" | "hindi" | "english">("hinglish");
  const [showGamesModal, setShowGamesModal] = useState(false);
  const [showJourney, setShowJourney] = useState(false);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingTimerRef = useRef<any>(null);
  // Guards against a double stop (timer limit + Send tap) and lets unmount clean up.
  const recordingActiveRef = useRef(false);

  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  // Replies whose quote could not be built locally are resolved from the server once per message.
  const replyResolveTriedRef = useRef<Set<string>>(new Set());
  const matchIdRef = useRef<string | undefined>(matchId);
  matchIdRef.current = matchId;
  messagesRef.current = messages;
  // The recording timer can stop a voice note from a stale closure, so it reads the draft through a ref.
  const replyDraftRef = useRef<Message | null>(null);
  replyDraftRef.current = replyDraft;

  const deletionContext = () => ({
    hidden: hiddenIdsRef.current,
    tombstones: tombstonesRef.current,
  });

  // Find match partner
  const matchItem = matches.find((m) => m.id === matchId);
  const otherUser: Profile = matchItem?.otherUser || {
    id: "unknown",
    name: "Match",
    age: 0,
    city: "",
    distanceKm: null,
    bio: "",
    photos: [],
    interests: [],
    intent: "",
  };

  // While this chat is focused, a foreground push for the same conversation is redundant.
  useFocusEffect(
    useCallback(() => {
      if (!matchId) return undefined;
      setActiveConversation(matchId);
      return () => clearActiveConversation(matchId);
    }, [matchId]),
  );

  // Screenshots and screen recording are blocked (Android) while this conversation is on screen.
  useScreenProtection();

  // Deletion bookkeeping belongs to one conversation: reset only when the conversation changes
  // (not when the auth user object is refreshed), and before the effect below fetches.
  useEffect(() => {
    setReactions({});
    hiddenIdsRef.current = new Set();
    tombstonesRef.current = new Map();
    confirmedTombstonesRef.current = new Set();
    inFlightDeletesRef.current = new Set();
    replyResolveTriedRef.current = new Set();
    setActionTarget(null);
    setConfirmEveryone(null);
    setReplyDraft(null);
  }, [matchId]);

  // A reply that arrived live without its quote (original older than what is loaded) gets it from the server.
  useEffect(() => {
    if (!matchId || !user) return;
    const pending = messages.filter(
      (m) => !m.deletedAt && !!m.replyToId && !m.replyTo && !replyResolveTriedRef.current.has(m.id),
    );
    if (pending.length === 0) return;
    pending.forEach((m) => replyResolveTriedRef.current.add(m.id));
    fetchMessagesForMatch(matchId, user.id).then((fresh) => {
      if (matchIdRef.current !== matchId || fresh.length === 0) return;
      setMessages((prev) => mergeReplyPreviews(prev, fresh));
    });
  }, [messages, matchId, user]);

  useEffect(() => {
    if (!matchId || !user) return;
    let cancelled = false;

    fetchMessagesForMatch(matchId, user.id).then((msgs) => {
      if (cancelled) return;
      setMessages(reconcileFetched(msgs, deletionContext()));
      markChatRead(matchId, user.id);
    });
    fetchReactionsForMatch(matchId).then((rows) => {
      if (!cancelled) setReactions(buildReactionMap(rows));
    });

    const handleRemoteTombstone = (id: string, deletedAt: string) => {
      // Remember it even when the user hid the message: a delete-for-me rollback must not resurrect content.
      tombstonesRef.current.set(id, deletedAt);
      confirmedTombstonesRef.current.add(id);
      setActionTarget((current) => (current?.id === id ? null : current));
      setConfirmEveryone((current) => (current?.id === id ? null : current));
      setReplyDraft((current) => (current?.id === id ? null : current));
      setReactions((prev) => clearMessageReactions(prev, id));
      if (hiddenIdsRef.current.has(id)) return;
      setMessages((prev) => applyTombstone(prev, id, deletedAt));
      refreshMatches();
    };

    // Tick updates for my messages: debounced, because marking a whole chat read fires one event per message.
    let receiptTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshReceipts = () => {
      if (receiptTimer) clearTimeout(receiptTimer);
      receiptTimer = setTimeout(() => {
        receiptTimer = null;
        fetchMessageReceipts(matchId, user.id).then((fresh) => {
          if (cancelled || fresh.length === 0) return;
          setMessages((prev) => mergeReceipts(prev, fresh));
        });
      }, 400);
    };

    const channel = subscribeToMatchMessages(
      matchId,
      (newMsg) => {
        setMessages((prev) => appendIncoming(prev, newMsg, deletionContext()));
        if (newMsg.from === "them") {
          markChatRead(matchId, user.id);
        }
      },
      user.id,
      {
        onMessageDeleted: ({ id, deletedAt }) => handleRemoteTombstone(id, deletedAt),
        onReceiptChanged: refreshReceipts,
        onReaction: (row) => setReactions((prev) => applyReactionRow(prev, row)),
        // The channel dropped and came back: deletions may have been missed, so reload the thread.
        // An empty result is ignored here because fetchMessagesForMatch also returns [] on network errors.
        onResync: () => {
          fetchMessagesForMatch(matchId, user.id).then((msgs) => {
            if (cancelled || msgs.length === 0) return;
            setMessages(reconcileFetched(msgs, deletionContext()));
          });
          fetchReactionsForMatch(matchId).then((rows) => {
            if (!cancelled) setReactions(buildReactionMap(rows));
          });
        },
      },
    );

    return () => {
      cancelled = true;
      if (receiptTimer) clearTimeout(receiptTimer);
      supabase.removeChannel(channel);
    };
  }, [matchId, user]);

  // Online + typing for this chat (Realtime presence/broadcast, nothing stored). Reset when the chat changes.
  useEffect(() => {
    setPartnerOnline(false);
    setPartnerTyping(false);
    if (!matchId || !user) return;
    const presence = joinChatPresence(matchId, user.id, {
      onPartnerOnline: setPartnerOnline,
      onPartnerTyping: setPartnerTyping,
    });
    presenceRef.current = presence;
    return () => {
      presence.leave();
      if (presenceRef.current === presence) presenceRef.current = null;
    };
  }, [matchId, user]);

  const handleInputChange = (text: string) => {
    setInputText(text);
    presenceRef.current?.notifyInput(text.trim().length > 0);
  };

  const upsertSentMessage = (sent: Message) => {
    // Realtime may already have delivered this row; replace it (the sent copy carries the signed media URL).
    setMessages((prev) => insertChronologically(prev, sent));
  };

  // Sets (or with null removes) my reaction. Optimistic; rolled back with a message when the server refuses.
  const reactToMessage = async (message: Message, emoji: string | null): Promise<void> => {
    if (!user || message.deletedAt) return;
    const previous = reactions[message.id]?.[user.id] ?? null;
    if (previous === emoji) return;
    setReactions((prev) => applyReactionRow(prev, { messageId: message.id, userId: user.id, emoji }));
    const res = await setMessageReaction(message.id, emoji);
    if (!res.success) {
      setReactions((prev) => applyReactionRow(prev, { messageId: message.id, userId: user.id, emoji: previous }));
      Alert.alert(
        "Reaction not sent",
        res.error === "network" ? "Check your connection and try again." : "This message can no longer be reacted to.",
      );
    }
  };

  const openMessageActions = (message: Message) => {
    if (!canDeleteForMe(message)) return;
    setMenuVisible(false);
    setActionTarget(message);
  };

  const runDelete = async (scope: DeleteScope, target: Message): Promise<void> => {
    const id = target.id;
    if (!user || inFlightDeletesRef.current.has(id)) return;
    inFlightDeletesRef.current.add(id);

    // What to restore if the server refuses. Prefer the live copy: its read status may have changed.
    const snapshot = messagesRef.current.find((m) => m.id === id) ?? target;

    // A message that is being deleted can no longer be replied to.
    setReplyDraft((current) => (current?.id === id ? null : current));

    // 1) Update the chat immediately.
    if (scope === "me") {
      hiddenIdsRef.current.add(id);
      setMessages((prev) => removeMessage(prev, id));
    } else {
      const optimisticAt = new Date().toISOString();
      tombstonesRef.current.set(id, optimisticAt);
      setMessages((prev) => applyTombstone(prev, id, optimisticAt));
    }

    // 2) Ask the server (retries only on connectivity trouble; both RPCs are idempotent).
    const res = await deleteMessage(scope, id);
    inFlightDeletesRef.current.delete(id);

    if (res.ok) {
      if (scope === "everyone") {
        confirmedTombstonesRef.current.add(id);
        if (res.deletedAt) tombstonesRef.current.set(id, res.deletedAt);
      }
      refreshMatches();
      return;
    }

    // The message no longer exists for this user (for example the match was removed): keep it gone.
    if (res.reason === "message_not_found") {
      if (scope === "everyone") {
        tombstonesRef.current.delete(id);
        setMessages((prev) => removeMessage(prev, id));
      }
      refreshMatches();
      Alert.alert("Message unavailable", res.message);
      return;
    }

    // 3) Roll back the optimistic change, unless the server already confirmed a tombstone meanwhile.
    if (scope === "me") {
      hiddenIdsRef.current.delete(id);
      const knownDeletedAt = tombstonesRef.current.get(id);
      setMessages((prev) =>
        insertChronologically(prev, knownDeletedAt ? tombstoneMessage(snapshot, knownDeletedAt) : snapshot),
      );
    } else if (!confirmedTombstonesRef.current.has(id)) {
      tombstonesRef.current.delete(id);
      setMessages((prev) => insertChronologically(prev, snapshot));
    }

    const title = scope === "me" ? "Couldn't delete message" : "Couldn't delete for everyone";
    if (res.retryable) {
      Alert.alert(title, res.message, [
        { text: "Cancel", style: "cancel" },
        { text: "Try again", onPress: () => void runDelete(scope, snapshot) },
      ]);
    } else {
      Alert.alert(title, res.message);
    }
  };

  // Tap on a quote: scroll to the original if it is loaded.
  const scrollToMessage = (id: string) => {
    const index = messagesRef.current.findIndex((m) => m.id === id);
    if (index === -1) {
      Alert.alert("Message not loaded", "That message is further back in the conversation.");
      return;
    }
    flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
  };

  const startReply = (message: Message) => {
    if (!canReplyTo(message)) return;
    setReplyDraft(message);
    // Let the action sheet close first, then bring up the keyboard.
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSend = async () => {
    const text = inputText.trim();
    if ((!text && !selectedImageUri) || !user || !matchId) return;

    setSending(true);
    const img = selectedImageUri || undefined;
    const replyTarget = replyDraft;
    setSelectedImageUri(null);
    setInputText("");
    setReplyDraft(null);
    presenceRef.current?.notifyStopped();

    const res = await sendChatMessage(matchId, user.id, text, img, false, replyTarget?.id);
    setSending(false);

    if (res.success && res.message) {
      upsertSentMessage(replyTarget ? { ...res.message, replyTo: buildReplyPreview(replyTarget) } : res.message);
      refreshMatches();
      flatListRef.current?.scrollToEnd({ animated: true });
    } else if (res.error === REPLY_TARGET_UNAVAILABLE) {
      // The original disappeared meanwhile: keep what the person wrote so it can be sent as a normal message.
      setInputText(text);
      setSelectedImageUri(img ?? null);
      Alert.alert(
        "Message unavailable",
        "The message you were replying to is no longer available. Your message was not sent.",
      );
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
      mediaTypes: ["images"],
      allowsEditing: false,
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
      upsertSentMessage(res.message);
      refreshMatches();
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  };

  const clearRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  const handleStartRecording = async () => {
    if (recordingActiveRef.current || sending) return;
    const adapter = getAudioRecorderAdapter();
    const perm = await adapter.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Microphone access needed",
        perm.canAskAgain
          ? "Allow microphone access to record voice messages."
          : "Microphone access is turned off for Chahat. You can turn it on in your phone's Settings > Apps > Chahat > Permissions.",
      );
      return;
    }

    const startRes = await adapter.startRecordingAsync(VOICE_LIMITS.maxDurationMs);
    if (!startRes.success) {
      Alert.alert("Voice message", startRes.error || "Could not start recording.");
      return;
    }

    recordingActiveRef.current = true;
    setIsRecording(true);
    setRecordingSeconds(0);
    const startedAt = Date.now();
    recordingTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setRecordingSeconds(elapsed);
      if (elapsed >= VOICE_LIMITS.maxDurationMs / 1000) {
        void handleStopAndSendRecording();
      }
    }, 250);
  };

  const handleStopAndSendRecording = async () => {
    if (!recordingActiveRef.current) return;
    recordingActiveRef.current = false;
    clearRecordingTimer();
    setIsRecording(false);
    setRecordingSeconds(0);

    const adapter = getAudioRecorderAdapter();
    const stopRes = await adapter.stopRecordingAsync();
    if (!stopRes.success || !stopRes.result) {
      if (stopRes.error) Alert.alert("Voice message", stopRes.error);
      return;
    }

    if (!user || !matchId) {
      await cleanupAbandonedVoiceFile(stopRes.result.uri);
      return;
    }

    setSending(true);
    const durationSec = Math.max(1, Math.round(stopRes.result.durationMs / 1000));
    const replyTarget = replyDraftRef.current;
    setReplyDraft(null);
    const res = await sendVoiceMessage(
      matchId,
      user.id,
      stopRes.result.uri,
      durationSec,
      stopRes.result.mimeType,
      replyTarget?.id,
    );
    setSending(false);
    // The local copy is no longer needed whether or not the upload worked.
    await cleanupAbandonedVoiceFile(stopRes.result.uri);

    if (res.success && res.message) {
      upsertSentMessage(replyTarget ? { ...res.message, replyTo: buildReplyPreview(replyTarget) } : res.message);
      refreshMatches();
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } else if (res.error === REPLY_TARGET_UNAVAILABLE) {
      Alert.alert(
        "Message unavailable",
        "The message you were replying to is no longer available. Your voice message was not sent.",
      );
    } else {
      Alert.alert("Couldn't send voice message", res.error || "Please check your connection and try again.");
    }
  };

  const handleCancelRecording = async () => {
    recordingActiveRef.current = false;
    clearRecordingTimer();
    setIsRecording(false);
    setRecordingSeconds(0);
    await getAudioRecorderAdapter().cancelRecordingAsync();
  };

  // Leaving the chat mid-recording discards it instead of leaving the microphone open.
  useEffect(() => {
    return () => {
      if (recordingActiveRef.current) {
        recordingActiveRef.current = false;
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        void getAudioRecorderAdapter().cancelRecordingAsync();
      }
      void getAudioPlayerAdapter().stopAsync();
    };
  }, []);

  const formatRecordingTime = (total: number) =>
    `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;

  const handleConfirmAction = async () => {
    if (!actionDialog) return;

    if (actionDialog === "block") {
      await blockUser(otherUser.id);
      Alert.alert("Blocked", `You have blocked ${otherUser.name}.`);
      refreshMatches();
      safeBack(router);
    } else if (actionDialog === "unmatch") {
      await unmatchUser(matchId);
      Alert.alert("Unmatched", `You have unmatched with ${otherUser.name}.`);
      refreshMatches();
      safeBack(router);
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
        <TouchableOpacity accessibilityLabel="Go back"
            onPress={() => safeBack(router)}
            style={styles.backBtn} activeOpacity={0.7}>
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
            {presenceLabel(partnerOnline, partnerTyping) ? (
              <Text style={styles.partnerStatus} testID="chat-presence-label">
                {presenceLabel(partnerOnline, partnerTyping)}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.actionIcon}
            accessibilityLabel="Start video call"
            onPress={() => void startVideoCallIfAllowed(router, matchId)}
          >
            <Video size={20} color={Colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionIcon} accessibilityLabel="More options"
            onPress={() => setMenuVisible(!menuVisible)}>
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
        behavior={undefined}
        style={styles.chatArea}
      >
        <FlatList
          keyboardShouldPersistTaps="handled"
          ref={flatListRef}
          data={messages}
          extraData={reactions}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <ChatBubble
              message={item}
              onLongPress={openMessageActions}
              reactions={summarizeReactions(reactions[item.id], user?.id)}
              onReactionPress={(m, emoji) =>
                void reactToMessage(m, nextReaction(reactions[m.id]?.[user?.id ?? ""] ?? null, emoji))
              }
              partnerName={otherUser.name}
              replyUnavailable={isReplyUnavailable(item, messages, deletionContext())}
              onReplyPress={scrollToMessage}
              onImagePress={setViewerUri}
              showDayHeader={
                index === 0 ||
                new Date(messages[index - 1]!.at).toDateString() !==
                  new Date(item.at).toDateString()
              }
            />
          )}
          contentContainerStyle={styles.messageList}
          onScrollToIndexFailed={(info) => {
            // Rows are not measured yet: get close first, then jump exactly.
            flatListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
            setTimeout(
              () => flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.4 }),
              250,
            );
          }}
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

        {/* Reply draft: the message the next send quotes */}
        {replyDraft && (
          <View style={styles.replyBar} testID="reply-draft-bar">
            <View style={styles.replyBarAccent} />
            <View style={styles.replyBarBody}>
              <Text style={styles.replyBarTitle} numberOfLines={1}>
                Replying to {replyAuthorLabel(buildReplyPreview(replyDraft), otherUser.name) || "message"}
              </Text>
              <Text style={styles.replyBarText} numberOfLines={1}>
                {replySnippet(buildReplyPreview(replyDraft))}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setReplyDraft(null)}
              accessibilityRole="button"
              accessibilityLabel="Cancel reply"
              testID="reply-draft-cancel"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={18} color={Colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        )}

        {/* Input Bar */}
        {isRecording ? (
          <View style={styles.inputBar} testID="voice-recording-bar">
            <TouchableOpacity
              style={styles.attachBtn}
              onPress={() => void handleCancelRecording()}
              accessibilityLabel="Cancel voice message"
              testID="voice-cancel"
              activeOpacity={0.7}
            >
              <Trash2 size={22} color={Colors.destructive} />
            </TouchableOpacity>
            <View style={styles.recordingInfo}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTime}>
                {formatRecordingTime(recordingSeconds)} / {formatRecordingTime(VOICE_LIMITS.maxDurationMs / 1000)}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.sendBtn}
              onPress={() => void handleStopAndSendRecording()}
              accessibilityLabel="Send voice message"
              testID="voice-send"
              activeOpacity={0.8}
            >
              <Send size={18} color={Colors.primaryForeground} />
            </TouchableOpacity>
          </View>
        ) : (
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={handlePickImage}
            activeOpacity={0.7}
            accessibilityLabel="Attach photo"
          >
            <ImagePlus size={22} color={Colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.attachBtn, showIcebreakers && styles.attachBtnActive]}
            accessibilityLabel="Conversation starters"
            onPress={() => setShowIcebreakers(!showIcebreakers)}
            activeOpacity={0.7}
          >
            <Sparkles size={20} color={showIcebreakers ? Colors.accent : Colors.mutedForeground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.attachBtn}
            onPress={() => setShowGamesModal(true)}
            activeOpacity={0.7}
            accessibilityLabel="Couple games"
          >
            <Trophy size={19} color={Colors.primary} />
          </TouchableOpacity>

          <ChatTextInput
            ref={inputRef}
            onKeyboardMedia={(media) => setSelectedImageUri(media.uri)}
            onKeyboardMediaError={(message) => Alert.alert("GIF", message)}
            style={styles.textInput}
            placeholder="Type a message or use icebreaker…"
            placeholderTextColor={Colors.mutedForeground}
            value={inputText}
            onChangeText={handleInputChange}
            multiline
            maxLength={1000}
          />

          {voiceEnabled && !inputText.trim() && !selectedImageUri ? (
            <TouchableOpacity
              style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
              onPress={() => void handleStartRecording()}
              disabled={sending}
              accessibilityLabel="Record voice message"
              testID="voice-record"
              activeOpacity={0.8}
            >
              <Mic size={18} color={Colors.primaryForeground} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.sendBtn,
                !inputText.trim() && !selectedImageUri && styles.sendBtnDisabled,
              ]}
              onPress={handleSend}
              disabled={(!inputText.trim() && !selectedImageUri) || sending}
              accessibilityLabel="Send message"
              testID="chat-send"
              activeOpacity={0.8}
            >
              <Send size={18} color={Colors.primaryForeground} />
            </TouchableOpacity>
          )}
        </View>
        )}
      </KeyboardAvoidingView>

      {/* Full-screen photo viewer */}
      <ImageViewerModal uri={viewerUri} onClose={() => setViewerUri(null)} />

      {/* Couple Games Modal */}
      <CoupleGamesModal
        visible={showGamesModal}
        partnerName={otherUser.name}
        onClose={() => setShowGamesModal(false)}
        onSendGameAnswer={handleSendGameAnswer}
      />

      {/* Message actions: Delete for me / Delete for everyone */}
      <MessageActionSheet
        visible={actionTarget !== null}
        canDeleteForEveryone={
          !!actionTarget && canDeleteMessageForEveryone(actionTarget, user?.id)
        }
        canReact={!!actionTarget && !actionTarget.deletedAt}
        canReply={canReplyTo(actionTarget)}
        onReply={() => {
          const target = actionTarget;
          setActionTarget(null);
          if (target) startReply(target);
        }}
        currentReaction={actionTarget && user ? (reactions[actionTarget.id]?.[user.id] ?? null) : null}
        onReact={(emoji) => {
          const target = actionTarget;
          setActionTarget(null);
          if (target && user) {
            void reactToMessage(target, nextReaction(reactions[target.id]?.[user.id] ?? null, emoji));
          }
        }}
        onDeleteForMe={() => {
          const target = actionTarget;
          setActionTarget(null);
          if (target) void runDelete("me", target);
        }}
        onDeleteForEveryone={() => {
          const target = actionTarget;
          setActionTarget(null);
          if (target) setConfirmEveryone(target);
        }}
        onClose={() => setActionTarget(null)}
      />

      <Dialog
        visible={confirmEveryone !== null}
        title="Delete for everyone?"
        body={`This message will be removed for you and ${otherUser.name}. This can't be undone.`}
        confirmText="Delete for everyone"
        danger
        onConfirm={() => {
          const target = confirmEveryone;
          setConfirmEveryone(null);
          if (target) void runDelete("everyone", target);
        }}
        onCancel={() => setConfirmEveryone(null)}
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
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
    gap: Spacing.sm,
  },
  backBtn: {
    padding: Spacing.sm,
  },
  partnerInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
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
    gap: Spacing.sm,
  },
  actionIcon: {
    padding: Spacing.sm,
  },
  journeyBar: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  journeyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  journeyTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  journeyTitle: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  journeyBody: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.xs,
  },
  journeyStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
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
    gap: Spacing.sm,
    backgroundColor: Colors.secondary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  safetyNoticeText: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
  },
  menuBanner: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: Spacing.xs,
    zIndex: 10,
  },
  menuOption: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Layout.screenPadding,
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
    paddingVertical: Spacing.lg,
    flexGrow: 1,
  },
  emptyMessages: {
    alignItems: "center",
    padding: Spacing.xxl,
    marginTop: Spacing.xxl,
  },
  emptyAvatar: {
    width: 80,
    height: 80,
    borderRadius: Radii.full,
    marginBottom: Spacing.lg,
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
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  starterQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radii.full,
    marginTop: Spacing.lg,
  },
  starterQuickBtnText: {
    color: Colors.primaryForeground,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
  },
  imagePreviewBar: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.sm,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.md,
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
  replyBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.md,
  },
  replyBarAccent: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  replyBarBody: {
    flex: 1,
  },
  replyBarTitle: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  replyBarText: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    marginTop: 1,
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
    paddingVertical: Spacing.md,
  },
  icebreakerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  icebreakerTabs: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  langTab: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
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
    padding: Spacing.xs,
  },
  closeDrawerText: {
    fontSize: Typography.sizes.base,
    color: Colors.mutedForeground,
  },
  icebreakersScroll: {
    paddingHorizontal: Spacing.md,
    gap: Spacing.md,
  },
  icebreakerChip: {
    backgroundColor: Colors.secondary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radii.lg,
    maxWidth: 240,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  icebreakerChipTag: {
    fontSize: Typography.sizes.xs,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
    marginBottom: Spacing.xs,
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
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
  },
  attachBtn: {
    padding: Spacing.sm,
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    fontSize: Typography.sizes.sm,
    color: Colors.foreground,
  },
  sendBtn: {
    width: Layout.minTap,
    height: Layout.minTap,
    borderRadius: Radii.full,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: Colors.muted,
  },
  recordingInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.destructive,
  },
  recordingTime: {
    color: Colors.foreground,
    fontSize: Typography.sizes.base,
    fontVariant: ["tabular-nums"],
  },
});
