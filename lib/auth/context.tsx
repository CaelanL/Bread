import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUTH_STORAGE_KEY, supabase } from '@/lib/api/client';
import { perfMark } from '@/lib/api/dev-timing';
import { unregisterDeviceToken } from '@/lib/notifications/tokens';
import { useAppStore } from '@/lib/store';
import { setAccount } from './account';
import { afterRestore } from './after-restore';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** The session came back from storage at launch, not from a sign-in during this run. */
  sessionRestored: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  deleteAccount: () => Promise<{ error: string | null }>;
}

/** How long launch waits on a session restore before showing the app anyway (also the splash's failsafe). */
export const SPLASH_FAILSAFE_MS = 3000;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [restoredUserId, setRestoredUserId] = useState<string | null>(null);

  // Handle deep link URLs (for password reset, OAuth callbacks)
  const handleDeepLink = async (url: string) => {
    // URL comes in as: com.biblemem://reset-password#access_token=xxx&refresh_token=xxx&type=recovery
    // Convert # to ? so we can parse params
    const parsedUrl = url.replace('#', '?');
    const { queryParams } = Linking.parse(parsedUrl);

    const accessToken = queryParams?.access_token as string | undefined;
    const refreshToken = queryParams?.refresh_token as string | undefined;
    const type = queryParams?.type as string | undefined;

    if (accessToken && refreshToken) {
      // Set the session from the tokens
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (!error && data.session) {
        // Update state immediately so it's available when we navigate
        setSession(data.session);
        setUser(data.session.user);

        if (type === 'recovery') {
          // Navigate to reset password screen
          router.replace('/reset-password');
        }
      }
    }
  };

  useEffect(() => {
    // The stored session's user, read once without waiting for a token refresh, so that account's
    // saved library paints at once (RootLayoutNav shows it while the session restores).
    const stored = AsyncStorage.getItem(AUTH_STORAGE_KEY).then((raw) => {
      const id: unknown = raw ? JSON.parse(raw)?.user?.id : null;
      if (typeof id !== 'string') return null;
      setAccount(id, { provisional: true });
      return id;
    }).catch(() => null);

    // Still restoring with nothing painted (offline, no saved library): show the app empty with the
    // load error rather than a spinner, still signed in. The session's TOKEN_REFRESHED below starts
    // the account when the network returns.
    const failsafe = setTimeout(() => {
      stored.then((id) => {
        if (id) void useAppStore.getState().showOffline(id);
      });
    }, SPLASH_FAILSAFE_MS);

    // Get initial session
    Promise.all([supabase.auth.getSession(), stored]).then(async ([{ data: { session }, error }, storedUserId]) => {
      perfMark('session');
      // Couldn't reach the server to refresh the token: stay on the saved library, still loading.
      // supabase-js keeps the session and retries; its TOKEN_REFRESHED below starts the account.
      if (afterRestore(storedUserId, { session, error }) === 'offline') return;
      clearTimeout(failsafe);
      // Before the tree mounts, so the library load starts now.
      setAccount(session?.user.id ?? null);
      // The saved library paints (once the load's requests are out) before the app's first render, so
      // that render already has it.
      if (session) await useAppStore.getState().paintSnapshot(session.user.id);
      if (session) setRestoredUserId(session.user.id);
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    // Listen for auth changes. The launch's own state comes from getSession above.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'INITIAL_SESSION') return;
        clearTimeout(failsafe);
        if (event === 'SIGNED_OUT') setRestoredUserId(null);
        setAccount(session?.user.id ?? null);
        setSession(session);
        setUser(session?.user ?? null);
        setIsLoading(false);
      }
    );

    // Handle deep links
    // Check if app was opened via deep link
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });

    // Listen for deep links while app is open
    const linkingSubscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    return () => {
      clearTimeout(failsafe);
      subscription.unsubscribe();
      linkingSubscription.remove();
    };
  }, []);

  const signUp = async (email: string, password: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return { error: error.message };
    }
    return { error: null };
  };

  const signIn = async (email: string, password: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { error: error.message };
    }
    return { error: null };
  };

  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'com.biblemem://',
      },
    });

    if (error) {
      return { error: error.message };
    }
    return { error: null };
  };

  const signOut = async (): Promise<void> => {
    // Before signing out: RLS lets only this user delete their row.
    // Best-effort; if it fails, the next sign-in on this device takes the row.
    await unregisterDeviceToken().catch((e) => {
      console.error('[auth] unregisterDeviceToken', e);
    });
    await supabase.auth.signOut();
  };

  const resetPassword = async (email: string): Promise<{ error: string | null }> => {
    // Production URL - must match Supabase Redirect URLs whitelist
    // Note: Password reset links must be opened on device with app installed
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'com.biblemem://reset-password/',
    });

    if (error) {
      return { error: error.message };
    }
    return { error: null };
  };

  const updatePassword = async (newPassword: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      return { error: error.message };
    }
    return { error: null };
  };

  const deleteAccount = async (): Promise<{ error: string | null }> => {
    // Call the PostgreSQL function that deletes the user
    const { error } = await supabase.rpc('delete_own_account');

    if (error) {
      return { error: error.message };
    }

    // Sign out after deletion (JWT still valid until expiry)
    await signOut();
    return { error: null };
  };

  const value: AuthContextType = {
    user,
    session,
    isLoading,
    isAuthenticated: !!session && !!user,
    sessionRestored: !!user && user.id === restoredUserId,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    resetPassword,
    updatePassword,
    deleteAccount,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
