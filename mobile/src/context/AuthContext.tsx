import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";
import { fetchMyProfile } from "../services/profile";
import { clearNotificationState, unregisterPushNotificationToken } from "../services/notifications";
import type { MeProfile } from "../types";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: MeProfile | null;
  loading: boolean;
  profileError: boolean;
  isLoggedIn: boolean;
  isOnboarded: boolean;
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
  refreshProfile: async () => {},
  signOut: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const activeUserId = useRef<string | null>(null);
  const profileRequest = useRef(0);
  const authEventVersion = useRef(0);

  const loadUserProfile = useCallback(async (currentUser: User, request: number) => {
    try {
      const currentProfile = await fetchMyProfile(currentUser.id, currentUser.email || "");
      if (profileRequest.current === request && activeUserId.current === currentUser.id) {
        setProfile(currentProfile);
        setProfileError(false);
      }
    } catch (error) {
      console.error("Failed to load profile", error);
      if (profileRequest.current === request && activeUserId.current === currentUser.id) {
        setProfile(null);
        setProfileError(true);
      }
    } finally {
      if (profileRequest.current === request && activeUserId.current === currentUser.id) {
        setLoading(false);
      }
    }
  }, []);

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
      setLoading(false);
      return;
    }

    const request = ++profileRequest.current;
    activeUserId.current = currentUser.id;
    setSession(data.session);
    setUser(currentUser);
    setProfile(null);
    setProfileError(false);
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
        console.warn("Could not unregister push token before sign-out:", tokenResult.error);
      }
    }

    const { error } = await supabase.auth.signOut();
    if (error) {
      const { error: localError } = await supabase.auth.signOut({ scope: "local" });
      if (localError)
        throw new Error(
          `Sign-out failed: ${error.message}; local cleanup failed: ${localError.message}`,
        );
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
        clearNotificationState(previousUserId).catch((error) => {
          console.error("Could not clear previous account notification cache:", error);
        });
      }

      if (!nextUser) {
        setProfile(null);
        setProfileError(false);
        setLoading(false);
        return;
      }

      if (event === "TOKEN_REFRESHED" && previousUserId === nextUserId) return;

      setProfile(null);
      setProfileError(false);
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
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
