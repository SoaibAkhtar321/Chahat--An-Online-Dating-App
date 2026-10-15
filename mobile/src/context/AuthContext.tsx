import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";
import { fetchMyProfile } from "../services/profile";
import { registerPushNotificationToken } from "../services/notifications";
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

  const loadUserProfile = async (currentUser: User) => {
    const requestId = ++profileLoadId.current;
    try {
      const prof = await fetchMyProfile(currentUser.id, currentUser.email || "");
      if (requestId !== profileLoadId.current || activeUserId.current !== currentUser.id) return;
      setProfile(prof);
      setProfileError(false);
      registerPushNotificationToken(currentUser.id).catch(() => {});
    } catch (e) {
      if (requestId !== profileLoadId.current || activeUserId.current !== currentUser.id) return;
      // Do NOT treat a failed load as "not onboarded": keep profile null and flag the error instead.
      console.error("Failed to load profile", e);
      setProfile(null);
      setProfileError(true);
    }
  };

  const refreshProfile = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    const current = data.user;
    if (!current) throw new Error("A signed-in account is required to refresh your profile.");
    activeUserId.current = current.id;
    setUser(current);
    await loadUserProfile(current);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    profileLoadId.current += 1;
    activeUserId.current = null;
    setSession(null);
    setUser(null);
    setProfile(null);
  };

  useEffect(() => {
    // Initial session load
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        activeUserId.current = session?.user?.id ?? null;
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          loadUserProfile(session.user).finally(() => setLoading(false));
        } else {
          setLoading(false);
        }
      })
      .catch((e) => {
        // Never leave the app on the startup spinner if session restore fails
        console.error("Failed to restore session", e);
        setLoading(false);
      });

    // Listen to auth events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (!session?.user) {
        profileLoadId.current += 1;
        activeUserId.current = null;
        setProfile(null);
        setProfileError(false);
        setLoading(false);
        return;
      }
      if (activeUserId.current !== session.user.id) {
        profileLoadId.current += 1;
        activeUserId.current = session.user.id;
        setProfile(null);
        setProfileError(false);
      }
      // Token refreshes don't need a reload. On sign-in keep `loading` true until the profile
      // is fetched, otherwise the router sees profile=null and sends a returning user to onboarding.
      if (_event === "TOKEN_REFRESHED") return;
      if (_event === "SIGNED_IN" || _event === "USER_UPDATED") setLoading(true);
      const u = session.user;
      // Defer: calling supabase inside this callback can deadlock the auth client.
      setTimeout(() => {
        loadUserProfile(u).finally(() => setLoading(false));
      }, 0);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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
