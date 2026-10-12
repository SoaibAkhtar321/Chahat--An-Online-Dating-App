import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { Profile, MatchItem, Filters, SwipeResponse } from "../types";
import { DEFAULT_FILTERS } from "../types";
import { useAuth } from "./AuthContext";
import { fetchDiscoveryDeck, submitSwipe, undoLastPass } from "../services/discovery";
import { fetchUserMatches } from "../services/chat";
import { getUserSubscription, type UserSubscription } from "../services/subscription";

interface MiloContextType {
  deck: Profile[];
  currentProfile: Profile | null;
  matches: MatchItem[];
  likesRemaining: number;
  lastPassedId: string | null;
  filters: Filters;
  loadingDeck: boolean;
  isBoosting: boolean;
  boostTimeRemaining: number;
  totalUnreadCount: number;
  subscription: UserSubscription | null;
  refreshSubscription: () => Promise<void>;
  swipeCard: (direction: "like" | "pass" | "priority") => Promise<SwipeResponse>;
  undoPass: () => Promise<boolean>;
  triggerBoost: () => void;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  refreshDeck: () => Promise<void>;
  refreshMatches: () => Promise<void>;
}

const MiloContext = createContext<MiloContextType>({
  deck: [],
  currentProfile: null,
  matches: [],
  likesRemaining: 10,
  lastPassedId: null,
  filters: DEFAULT_FILTERS,
  loadingDeck: false,
  isBoosting: false,
  boostTimeRemaining: 0,
  totalUnreadCount: 0,
  subscription: null,
  refreshSubscription: async () => {},
  swipeCard: async () => ({ success: false, isMatch: false, likesRemaining: 10 }),
  undoPass: async () => false,
  triggerBoost: () => {},
  setFilters: () => {},
  refreshDeck: async () => {},
  refreshMatches: async () => {},
});

export const MiloProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, isLoggedIn } = useAuth();
  const [deck, setDeck] = useState<Profile[]>([]);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [likesRemaining, setLikesRemaining] = useState<number>(10);
  const [lastPassedId, setLastPassedId] = useState<string | null>(null);
  const [lastPassedProfile, setLastPassedProfile] = useState<Profile | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [loadingDeck, setLoadingDeck] = useState<boolean>(false);
  const [isBoosting, setIsBoosting] = useState<boolean>(false);
  const [boostUntil, setBoostUntil] = useState<number>(0);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);

  const refreshSubscription = useCallback(async () => {
    const sub = await getUserSubscription();
    setSubscription(sub);
  }, []);

  const refreshDeck = useCallback(async () => {
    if (!user) return;
    setLoadingDeck(true);
    try {
      const list = await fetchDiscoveryDeck(user.id, profile?.city || "", profile?.seeking || "", filters);
      setDeck(list);
    } finally {
      setLoadingDeck(false);
    }
  }, [user, profile?.city, profile?.seeking, filters]);

  const refreshMatches = useCallback(async () => {
    if (!user) return;
    const items = await fetchUserMatches(user.id);
    setMatches(items);
  }, [user]);

  useEffect(() => {
    refreshSubscription();
  }, [refreshSubscription]);

  useEffect(() => {
    if (isLoggedIn && user) {
      refreshDeck();
      refreshMatches();
    } else {
      setDeck([]);
      setMatches([]);
    }
  }, [isLoggedIn, user, refreshDeck, refreshMatches]);

  const swipeCard = async (direction: "like" | "pass" | "priority"): Promise<SwipeResponse> => {
    if (deck.length === 0) {
      return { success: false, isMatch: false, likesRemaining };
    }

    const target = deck[0]!;
    const remainingDeck = deck.slice(1);
    setDeck(remainingDeck);

    if (direction === "pass") {
      setLastPassedId(target.id);
      setLastPassedProfile(target);
    }

    const res = await submitSwipe(target.id, direction);
    if (res.likesRemaining !== undefined) {
      setLikesRemaining(res.likesRemaining);
    }

    if (res.isMatch) {
      refreshMatches();
    }

    return res;
  };

  const undoPass = async (): Promise<boolean> => {
    if (!lastPassedId || !lastPassedProfile) return false;
    const ok = await undoLastPass(lastPassedId);
    if (ok) {
      setDeck([lastPassedProfile, ...deck]);
      setLastPassedId(null);
      setLastPassedProfile(null);
      return true;
    }
    return false;
  };

  const triggerBoost = () => {
    const end = Date.now() + 30 * 60 * 1000;
    setBoostUntil(end);
    setIsBoosting(true);
  };

  const boostTimeRemaining = Math.max(0, Math.round((boostUntil - Date.now()) / 60000));
  const totalUnreadCount = matches.reduce((acc, m) => acc + (m.unreadCount || 0), 0);
  const currentProfile = deck[0] || null;

  return (
    <MiloContext.Provider
      value={{
        deck,
        currentProfile,
        matches,
        likesRemaining,
        lastPassedId,
        filters,
        loadingDeck,
        isBoosting,
        boostTimeRemaining,
        totalUnreadCount,
        subscription,
        refreshSubscription,
        swipeCard,
        undoPass,
        triggerBoost,
        setFilters,
        refreshDeck,
        refreshMatches,
      }}
    >
      {children}
    </MiloContext.Provider>
  );
};

export const useMilo = () => useContext(MiloContext);
