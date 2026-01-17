import React, { createContext, useContext, useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { supabase } from '@/lib/api/client';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  deleteAccount: () => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (!error && type === 'recovery') {
        // Navigate to reset password screen
        router.replace('/reset-password');
      }
    }
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
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
