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
  /** Short technical reason the last profile load failed (shown on the retry screen to make problems diagnosable). */
  profileErrorDetail?: string | null;
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
  const [profileErrorDetail, setProfileErrorDetail] = useState<string | null>(null);
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
      // A brand-new account can race its profile row: retry briefly before showing the error screen.
      let currentProfile: Awaited<ReturnType<typeof fetchMyProfile>> | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          currentProfile = await fetchMyProfile(currentUser.id, currentUser.email || "");
          break;
        } catch (loadError) {
          if (attempt >= 2) throw loadError;
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (profileRequest.current !== request || activeUserId.current !== currentUser.id) return;
        }
      }
      if (profileRequest.current !== request || activeUserId.current !== currentUser.id) return;
      setProfile(currentProfile);
      setProfileError(false);
      setProfileErrorDetail(null);
      void loadLegalStatus(currentUser.id, request);
      void registerPushNotificationToken(currentUser.id).then((result) => {
        if (result.status === "error") console.warn("Push registration failed:", result.error);
      });
    } catch (error) {
      if (profileRequest.current !== request || activeUserId.current !== currentUser.id) return;
      console.error("Failed to load profile", error);
      setProfile(null);
      setProfileError(true);
      setProfileErrorDetail(error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200));
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
    // Logging out must always succeed on this device. Server-side cleanup (push token, session revocation) is best-effort
    // and only logged; the one hard failure is not being able to clear the local session.
    let userId: string | null = activeUserId.current;
    try {
      const { data } = await supabase.auth.getSession();
      userId = data.session?.user.id ?? userId;
    } catch (sessionError) {
      console.error("Could not read session during sign-out:", sessionError);
    }

    if (userId) {
      try {
        const tokenResult = await unregisterPushNotificationToken(userId);
        if (!tokenResult.success) {
          console.error("Push token was not unregistered during sign-out:", tokenResult.error);
        }
      } catch (tokenError) {
        console.error("Push token cleanup failed during sign-out:", tokenError);
      }
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("Server session revocation failed; clearing local session:", error);
      const { error: localError } = await supabase.auth.signOut({ scope: "local" });
      if (localError) {
        throw new Error("We couldn't log you out on this device. Please close the app and try again.");
      }
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
        profileErrorDetail,
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
