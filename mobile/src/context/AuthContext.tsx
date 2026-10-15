import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import * as Notifications from "expo-notifications";
import { supabase } from "../services/supabase";
import { fetchMyProfile } from "../services/profile";
import {
  registerPushNotificationToken,
  unregisterPushNotificationToken,
} from "../services/notifications";
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
  const [loading, setLoading] = useState<boolean>(true);
  const [profileError, setProfileError] = useState<boolean>(false);
  const profileLoadId = useRef(0);
  const activeUserId = useRef<string | null>(null);
  const authEventVersion = useRef(0);

  const loadUserProfile = async (currentUser: User) => {
    const requestId = ++profileLoadId.current;
    try {
      const prof = await fetchMyProfile(currentUser.id, currentUser.email || "");
      if (requestId !== profileLoadId.current || activeUserId.current !== currentUser.id) return;
      setProfile(prof);
      setProfileError(false);
      void registerPushNotificationToken(currentUser.id).then((result) => {
        if (result.status === "error") console.warn("Push registration failed:", result.error);
      });
    } catch (e) {
      if (requestId !== profileLoadId.current || activeUserId.current !== currentUser.id) return;
      // Do NOT treat a failed load as "not onboarded": keep profile null and flag the error instead.
      console.error("Failed to load profile", e);
      setProfile(null);
      setProfileError(true);
    } finally {
      if (requestId === profileLoadId.current && activeUserId.current === currentUser.id) {
        setLoading(false);
      }
    }
  };

  const refreshProfile = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    const current = data.user;
    if (!current) throw new Error("A signed-in account is required to refresh your profile.");
    activeUserId.current = current.id;
    setUser(current);
    setLoading(true);
    await loadUserProfile(current);
  };

  const handleSignOut = async () => {
    if (user) {
      try {
        await unregisterPushNotificationToken(user.id);
      } catch (err) {
        console.warn("Could not unregister push token before sign out:", err);
      }
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    profileLoadId.current += 1;
    activeUserId.current = null;
    setSession(null);
    setUser(null);
    setProfile(null);
  };

  useEffect(() => {
    const initialEventVersion = authEventVersion.current;
    // Initial session load
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (authEventVersion.current !== initialEventVersion) return;
        activeUserId.current = session?.user?.id ?? null;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          void loadUserProfile(session.user);
        } else {
          setLoading(false);
        }
      })
      .catch((e) => {
        if (authEventVersion.current !== initialEventVersion) return;
        // Never leave the app on the startup spinner if session restore fails
        console.error("Failed to restore session", e);
        setProfileError(true);
        setLoading(false);
      });

    // Listen to auth events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      authEventVersion.current += 1;
      const previousUserId = activeUserId.current;
      const nextUserId = session?.user.id ?? null;
      setSession(session);
      setUser(session?.user ?? null);
      activeUserId.current = nextUserId;
      if (previousUserId && previousUserId !== nextUserId) {
        void unregisterPushNotificationToken(previousUserId).catch((err) =>
          console.warn("Could not unregister prior account's push token:", err),
        );
      }
      if (!session?.user) {
        profileLoadId.current += 1;
        setProfile(null);
        setProfileError(false);
        setLoading(false);
        return;
      }
      if (previousUserId !== nextUserId) {
        profileLoadId.current += 1;
        activeUserId.current = session.user.id;
        setProfile(null);
        setProfileError(false);
      }
      // Token refreshes don't need a reload. On sign-in keep `loading` true until the profile
      // is fetched, otherwise the router sees profile=null and sends a returning user to onboarding.
      if (event === "TOKEN_REFRESHED" && previousUserId === nextUserId) return;
      setLoading(true);
      const u = session.user;
      // Defer: calling supabase inside this callback can deadlock the auth client.
      setTimeout(() => {
        void loadUserProfile(u);
      }, 0);
    });

    return () => {
      profileLoadId.current += 1;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const subscription = Notifications.addPushTokenListener(() => {
      registerPushNotificationToken(user.id).then((result) => {
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
        refreshProfile,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
