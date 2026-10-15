import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { Profile, MatchItem, Filters, SwipeResponse } from "../types";
import { DEFAULT_FILTERS } from "../types";
import { useAuth } from "./AuthContext";
import { fetchDiscoveryDeck, submitSwipe, undoLastPass } from "../services/discovery";
import { fetchUserMatches } from "../services/chat";
import {
  getDailyLikeQuota,
  getUserSubscription,
  type UserSubscription,
} from "../services/subscription";

interface MiloContextType {
  deck: Profile[];
  currentProfile: Profile | null;
  matches: MatchItem[];
  likesRemaining: number;
  dailyLikeLimit: number | null;
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
  triggerBoost: () => boolean;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  refreshDeck: () => Promise<void>;
  refreshMatches: () => Promise<void>;
}

const MiloContext = createContext<MiloContextType>({
  deck: [],
  currentProfile: null,
  matches: [],
  likesRemaining: 0,
  dailyLikeLimit: null,
  lastPassedId: null,
  filters: DEFAULT_FILTERS,
  loadingDeck: false,
  isBoosting: false,
  boostTimeRemaining: 0,
  totalUnreadCount: 0,
  subscription: null,
  refreshSubscription: async () => {},
  swipeCard: async () => ({ success: false, isMatch: false, likesRemaining: 0 }),
  undoPass: async () => false,
  triggerBoost: () => false,
  setFilters: () => {},
  refreshDeck: async () => {},
  refreshMatches: async () => {},
});

export const MiloProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, isLoggedIn } = useAuth();
  const [deck, setDeck] = useState<Profile[]>([]);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [likesRemaining, setLikesRemaining] = useState<number>(0);
  const [dailyLikeLimit, setDailyLikeLimit] = useState<number | null>(null);
  const [lastPassedId, setLastPassedId] = useState<string | null>(null);
  const [lastPassedProfile, setLastPassedProfile] = useState<Profile | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [loadingDeck, setLoadingDeck] = useState<boolean>(false);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const activeUserId = useRef<string | null>(user?.id ?? null);
  const deckRequest = useRef(0);
  const matchesRequest = useRef(0);
  const subscriptionRequest = useRef(0);
  const currentUserId = user?.id ?? null;

  useEffect(() => {
    if (activeUserId.current === currentUserId) return;
    activeUserId.current = currentUserId;
    deckRequest.current += 1;
    matchesRequest.current += 1;
    subscriptionRequest.current += 1;
    setDeck([]);
    setMatches([]);
    setLikesRemaining(0);
    setDailyLikeLimit(null);
    setLastPassedId(null);
    setLastPassedProfile(null);
    setFilters(DEFAULT_FILTERS);
    setLoadingDeck(false);
    setSubscription(null);
  }, [currentUserId]);

  const refreshSubscription = useCallback(async () => {
    const request = ++subscriptionRequest.current;
    try {
      const result = await getUserSubscription();
      if (subscriptionRequest.current === request && activeUserId.current === user?.id) {
        setSubscription(result);
      }
    } catch (error) {
      if (subscriptionRequest.current === request && activeUserId.current === user?.id) {
        console.warn("Could not verify subscription state:", error);
        setSubscription(null);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    if (!user?.id) {
      setDailyLikeLimit(null);
      setLikesRemaining(0);
      return () => {
        active = false;
      };
    }
    setDailyLikeLimit(null);
    setLikesRemaining(0);
    getDailyLikeQuota()
      .then((quota) => {
        if (!active) return;
        setDailyLikeLimit(quota.dailyLimit);
        setLikesRemaining(quota.likesRemaining);
      })
      .catch((error) => {
        if (active) console.warn("Could not load authoritative like quota:", error);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const refreshDeck = useCallback(async () => {
    if (!user) return;
    const request = ++deckRequest.current;
    const requestedUserId = user.id;
    setLoadingDeck(true);
    try {
      const list = await fetchDiscoveryDeck(
        user.id,
        profile?.city || "",
        profile?.seeking || "",
        filters,
      );
      if (deckRequest.current === request && activeUserId.current === requestedUserId) {
        setDeck(list);
      }
    } finally {
      if (deckRequest.current === request && activeUserId.current === requestedUserId) {
        setLoadingDeck(false);
      }
    }
  }, [user, profile?.city, profile?.seeking, filters]);

  const refreshMatches = useCallback(async () => {
    if (!user) return;
    const request = ++matchesRequest.current;
    const requestedUserId = user.id;
    const items = await fetchUserMatches(user.id);
    if (matchesRequest.current === request && activeUserId.current === requestedUserId) {
      setMatches(items);
    }
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
    if (!user || deck.length === 0) {
      return { success: false, isMatch: false, likesRemaining };
    }

    const target = deck[0]!;
    const remainingDeck = deck.slice(1);
    setDeck(remainingDeck);

    if (direction === "pass") {
      setLastPassedId(target.id);
      setLastPassedProfile(target);
    }

    const requestedUserId = user.id;
    const res = await submitSwipe(target.id, direction, user.id);
    if (activeUserId.current !== requestedUserId) return res;
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
    const requestedUserId = user?.id;
    if (!requestedUserId) return false;
    const ok = await undoLastPass(lastPassedId);
    if (activeUserId.current !== requestedUserId) return false;
    if (ok) {
      setDeck([lastPassedProfile, ...deck]);
      setLastPassedId(null);
      setLastPassedProfile(null);
      return true;
    }
    return false;
  };

  const triggerBoost = () => false;
  const isBoosting = false;
  const boostTimeRemaining = 0;
  const totalUnreadCount = matches.reduce((acc, m) => acc + (m.unreadCount || 0), 0);
  const currentProfile = deck[0] || null;

  return (
    <MiloContext.Provider
      value={{
        deck,
        currentProfile,
        matches,
        likesRemaining,
        dailyLikeLimit,
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
