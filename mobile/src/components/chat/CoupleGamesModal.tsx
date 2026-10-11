import React, { useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from "react-native";
import { X, Sparkles, Trophy, CheckCircle2 } from "lucide-react-native";
import { Colors, Radii, Shadows, Typography } from "../../constants/theme";

interface CoupleGamesModalProps {
  visible: boolean;
  partnerName: string;
  onClose: () => void;
  onSendGameAnswer: (text: string) => void;
}

const THIS_OR_THAT_QUESTIONS = [
  { id: "tot1", optA: "Adrak Chai ☕", optB: "Filter Coffee ☕" },
  { id: "tot2", optA: "Mountains 🏔️", optB: "Beaches 🏖️" },
  { id: "tot3", optA: "Late Night Talks 🌙", optB: "Early Morning Sunrise 🌅" },
  { id: "tot4", optA: "Street Food Crawl 🥟", optB: "Rooftop Fine Dining 🍷" },
  { id: "tot5", optA: "Dogs 🐶", optB: "Cats 🐱" },
  { id: "tot6", optA: "Bollywood Classics 🎬", optB: "Hollywood Sci-Fi 🚀" },
];

const MINI_QUIZ_QUESTIONS = [
  {
    id: "q1",
    question: "Ideal First Date:",
    options: ["Casual Coffee Walk", "Bookstore & Chai", "Live Music Gig", "Theme Park Adventure"],
  },
  {
    id: "q2",
    question: "Travel Style:",
    options: ["Carefully Planned Itinerary", "Spontaneous / Go with the Flow", "Luxury Resort Chill", "Backpacking & Hostels"],
  },
  {
    id: "q3",
    question: "Love Language:",
    options: ["Quality Time", "Thoughtful Words & Texts", "Small Surprises & Gifts", "Acts of Care"],
  },
];

export const CoupleGamesModal: React.FC<CoupleGamesModalProps> = ({
  visible,
  partnerName,
  onClose,
  onSendGameAnswer,
}) => {
  const [activeTab, setActiveTab] = useState<"thisOrThat" | "quiz">("thisOrThat");
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});

  const handlePickThisOrThat = (qId: string, choice: string) => {
    setSelectedAnswers((prev) => ({ ...prev, [qId]: choice }));
    onSendGameAnswer(`🎮 Couple Game: [This or That] I picked "${choice}"! What about you, ${partnerName}?`);
  };

  const handlePickQuiz = (qId: string, question: string, option: string) => {
    setSelectedAnswers((prev) => ({ ...prev, [qId]: option }));
    onSendGameAnswer(`🧩 Mini Quiz: "${question}" -> My answer is "${option}"! What's yours, ${partnerName}?`);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Sparkles size={20} color={Colors.primary} />
              <Text style={styles.title}>Couple Games & Polls</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <X size={20} color={Colors.foreground} />
            </TouchableOpacity>
          </View>

          <Text style={styles.subtitle}>
            Break the ice and discover what you and {partnerName} have in common!
          </Text>

          {/* Tabs */}
          <View style={styles.tabsRow}>
            <TouchableOpacity
              style={[styles.tab, activeTab === "thisOrThat" && styles.tabActive]}
              onPress={() => setActiveTab("thisOrThat")}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, activeTab === "thisOrThat" && styles.tabTextActive]}>
                This or That
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tab, activeTab === "quiz" && styles.tabActive]}
              onPress={() => setActiveTab("quiz")}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, activeTab === "quiz" && styles.tabTextActive]}>
                Quick Mini-Quiz
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollList} showsVerticalScrollIndicator={false}>
            {activeTab === "thisOrThat" ? (
              <View style={styles.cardList}>
                {THIS_OR_THAT_QUESTIONS.map((item) => {
                  const chosen = selectedAnswers[item.id];
                  return (
                    <View key={item.id} style={styles.gameCard}>
                      <View style={styles.optionsRow}>
                        <TouchableOpacity
                          style={[
                            styles.choiceBtn,
                            chosen === item.optA && styles.choiceBtnSelected,
                          ]}
                          onPress={() => handlePickThisOrThat(item.id, item.optA)}
                          activeOpacity={0.8}
                        >
                          <Text
                            style={[
                              styles.choiceText,
                              chosen === item.optA && styles.choiceTextSelected,
                            ]}
                          >
                            {item.optA}
                          </Text>
                          {chosen === item.optA && (
                            <CheckCircle2 size={16} color={Colors.primaryForeground} />
                          )}
                        </TouchableOpacity>

                        <Text style={styles.vsBadge}>VS</Text>

                        <TouchableOpacity
                          style={[
                            styles.choiceBtn,
                            chosen === item.optB && styles.choiceBtnSelected,
                          ]}
                          onPress={() => handlePickThisOrThat(item.id, item.optB)}
                          activeOpacity={0.8}
                        >
                          <Text
                            style={[
                              styles.choiceText,
                              chosen === item.optB && styles.choiceTextSelected,
                            ]}
                          >
                            {item.optB}
                          </Text>
                          {chosen === item.optB && (
                            <CheckCircle2 size={16} color={Colors.primaryForeground} />
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.cardList}>
                {MINI_QUIZ_QUESTIONS.map((q) => (
                  <View key={q.id} style={styles.quizCard}>
                    <Text style={styles.quizQuestion}>{q.question}</Text>
                    <View style={styles.quizOptions}>
                      {q.options.map((opt) => {
                        const isPicked = selectedAnswers[q.id] === opt;
                        return (
                          <TouchableOpacity
                            key={opt}
                            style={[styles.quizOptionBtn, isPicked && styles.quizOptionPicked]}
                            onPress={() => handlePickQuiz(q.id, q.question, opt)}
                            activeOpacity={0.8}
                          >
                            <Text
                              style={[
                                styles.quizOptionText,
                                isPicked && styles.quizOptionTextPicked,
                              ]}
                            >
                              {opt}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.hintBox}>
              <Trophy size={18} color={Colors.accent} />
              <Text style={styles.hintText}>
                Your choice sends an invitation into your chat so {partnerName} can respond!
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  subtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    marginBottom: 16,
  },
  tabsRow: {
    flexDirection: "row",
    backgroundColor: Colors.secondary,
    borderRadius: Radii.lg,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: Radii.md,
  },
  tabActive: {
    backgroundColor: Colors.card,
    ...Shadows.card,
  },
  tabText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.medium,
    color: Colors.mutedForeground,
  },
  tabTextActive: {
    color: Colors.foreground,
    fontWeight: Typography.weights.bold,
  },
  scrollList: {
    paddingBottom: 20,
  },
  cardList: {
    gap: 12,
  },
  gameCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  choiceBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: Colors.secondary,
    borderRadius: Radii.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  choiceBtnSelected: {
    backgroundColor: Colors.primary,
  },
  choiceText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
    textAlign: "center",
  },
  choiceTextSelected: {
    color: Colors.primaryForeground,
  },
  vsBadge: {
    fontSize: 11,
    fontWeight: Typography.weights.bold,
    color: Colors.mutedForeground,
  },
  quizCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quizQuestion: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: 12,
  },
  quizOptions: {
    gap: 8,
  },
  quizOptionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: Colors.secondary,
    borderRadius: Radii.md,
  },
  quizOptionPicked: {
    backgroundColor: Colors.primary,
  },
  quizOptionText: {
    fontSize: Typography.sizes.xs,
    color: Colors.foreground,
    fontWeight: Typography.weights.medium,
  },
  quizOptionTextPicked: {
    color: Colors.primaryForeground,
    fontWeight: Typography.weights.bold,
  },
  hintBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 18,
    backgroundColor: Colors.secondary,
    padding: 12,
    borderRadius: Radii.lg,
  },
  hintText: {
    flex: 1,
    fontSize: Typography.sizes.xs,
    color: Colors.secondaryForeground,
  },
});
