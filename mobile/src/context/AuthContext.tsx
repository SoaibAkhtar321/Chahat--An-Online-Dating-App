import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import * as Notifications from "expo-notifications";
import { supabase } from "../services/supabase";
import { fetchMyProfile } from "../services/profile";
import {
  clearNotificationState,
  registerPushNotificationToken,
  unregisterPushNotificationToken,
} from "../services/notifications";
import { fetchLegalStatus } from "../services/legalAcceptance";
import type { LegalGateStatus } from "../utils/legalGate";
import type { MeProfile } from "../types";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: MeProfile | null;
  loading: boolean;
  profileError: boolean;
  isLoggedIn: boolean;
  isOnboarded: boolean;
  legalStatus: LegalGateStatus;
  refreshLegalStatus: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  profileError: false,
  isLoggedIn: false,
  isOnboarded: false,
  legalStatus: "unknown",
  refreshLegalStatus: async () => {},
  refreshProfile: async () => {},
  signOut: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [legalStatus, setLegalStatus] = useState<LegalGateStatus>("unknown");
  const activeUserId = useRef<string | null>(null);
  const profileRequest = useRef(0);
  const authEventVersion = useRef(0);

  // Has the user accepted the CURRENT Terms/Privacy versions? Unknown until checked; a failed check is "error", never a guess.
  const loadLegalStatus = useCallback(async (userId: string, request: number) => {
    try {
      const status = await fetchLegalStatus(userId);
      if (profileRequest.current === request && activeUserId.current === userId) setLegalStatus(status);
    } catch (error) {
      console.error("Failed to load legal acceptance status", error);
      if (profileRequest.current === request && activeUserId.current === userId) setLegalStatus("error");
    }
  }, []);

  const loadUserProfile = useCallback(async (currentUser: User, request: number) => {
    try {
      const currentProfile = await fetchMyProfile(currentUser.id, currentUser.email || "");
      if (profileRequest.current !== request || activeUserId.current !== currentUser.id) return;
      setProfile(currentProfile);
      setProfileError(false);
      void loadLegalStatus(currentUser.id, request);
      void registerPushNotificationToken(currentUser.id).then((result) => {
        if (result.status === "error") console.warn("Push registration failed:", result.error);
      });
    } catch (error) {
      if (profileRequest.current !== request || activeUserId.current !== currentUser.id) return;
      console.error("Failed to load profile", error);
      setProfile(null);
      setProfileError(true);
    } finally {
      if (profileRequest.current === request && activeUserId.current === currentUser.id) {
        setLoading(false);
      }
    }
  }, [loadLegalStatus]);

  const refreshLegalStatus = useCallback(async () => {
    const userId = activeUserId.current;
    if (!userId) return;
    setLegalStatus("unknown");
    await loadLegalStatus(userId, profileRequest.current);
  }, [loadLegalStatus]);

  const refreshProfile = useCallback(async () => {
    const eventVersion = authEventVersion.current;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (authEventVersion.current !== eventVersion) return;

    const currentUser = data.session?.user;
    if (!currentUser) {
      profileRequest.current += 1;
      activeUserId.current = null;
      setSession(null);
      setUser(null);
      setProfile(null);
      setProfileError(false);
      setLegalStatus("unknown");
      setLoading(false);
      return;
    }

    const request = ++profileRequest.current;
    activeUserId.current = currentUser.id;
    setSession(data.session);
    setUser(currentUser);
    setProfile(null);
    setProfileError(false);
    setLegalStatus("unknown");
    setLoading(true);
    await loadUserProfile(currentUser, request);
  }, [loadUserProfile]);

  const signOut = useCallback(async () => {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    const userId = data.session?.user.id ?? activeUserId.current;

    if (userId) {
      const tokenResult = await unregisterPushNotificationToken(userId);
      if (!tokenResult.success) {
        throw new Error(`Could not securely sign out: ${tokenResult.error}`);
      }
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      const { error: localError } = await supabase.auth.signOut({ scope: "local" });
      if (localError) {
        throw new Error(
          `Sign-out failed: ${error.message}; local cleanup failed: ${localError.message}`,
        );
      }
      throw new Error(
        `Signed out on this device, but server session revocation failed: ${error.message}`,
      );
    }

    if (userId) {
      try {
        await clearNotificationState(userId);
      } catch (cleanupError) {
        console.error("Could not clear account notification cache:", cleanupError);
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const initialEventVersion = authEventVersion.current;

    const applySession = (nextSession: Session | null, event: string) => {
      const previousUserId = activeUserId.current;
      const nextUser = nextSession?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      const request = ++profileRequest.current;
      activeUserId.current = nextUserId;
      setSession(nextSession);
      setUser(nextUser);

      if (previousUserId && previousUserId !== nextUserId) {
        void clearNotificationState(previousUserId).catch((error) => {
          console.error("Could not clear previous account notification cache:", error);
        });
      }

      if (!nextUser) {
        setProfile(null);
        setProfileError(false);
        setLegalStatus("unknown");
        setLoading(false);
        return;
      }

      if (event === "TOKEN_REFRESHED" && previousUserId === nextUserId) return;

      setProfile(null);
      setProfileError(false);
      setLegalStatus("unknown");
      setLoading(true);
      setTimeout(() => {
        if (mounted) void loadUserProfile(nextUser, request);
      }, 0);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      authEventVersion.current += 1;
      applySession(nextSession, event);
    });

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted || authEventVersion.current !== initialEventVersion) return;
        if (error) {
          console.error("Failed to restore session", error);
          setLoading(false);
          setProfileError(true);
          return;
        }
        applySession(data.session, "INITIAL_SESSION");
      })
      .catch((error) => {
        if (!mounted) return;
        console.error("Failed to restore session", error);
        setLoading(false);
        setProfileError(true);
      });

    return () => {
      mounted = false;
      profileRequest.current += 1;
      subscription.unsubscribe();
    };
  }, [loadUserProfile]);

  useEffect(() => {
    if (!user) return;
    const subscription = Notifications.addPushTokenListener(() => {
      void registerPushNotificationToken(user.id).then((result) => {
        if (result.status === "error") console.warn("Push token refresh failed:", result.error);
      });
    });
    return () => subscription.remove();
  }, [user?.id]);

  const isOnboarded = !!profile?.onboarded;

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading,
        profileError,
        isLoggedIn: !!user,
        isOnboarded,
        legalStatus,
        refreshLegalStatus,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
