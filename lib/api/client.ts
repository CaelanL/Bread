import { createClient, SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { timedFetch } from "./dev-timing";

// Read from process.env (Expo automatically injects EXPO_PUBLIC_* vars)
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase configuration missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env"
  );
}

// Only use AsyncStorage on native platforms, use default (localStorage) on web
const storage = Platform.OS === "web" ? undefined : AsyncStorage;

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Required for React Native
  },
  global: { fetch: timedFetch },
});

/**
 * Ensure user is authenticated (anonymous or signed in)
 * Call this early in app lifecycle
 */
export async function ensureAuth(): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // Sign in anonymously - creates a user without email/password
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.error("Anonymous auth failed:", error);
      throw new Error("Authentication failed");
    }
  }
}

/**
 * Get current auth token for API calls
 */
export async function getAuthToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }

  return session.access_token;
}

/**
 * Get the Supabase URL for edge functions
 */
export function getSupabaseUrl(): string {
  return supabaseUrl ?? "";
}
