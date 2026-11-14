import { createClient, SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { authStorageKey } from "../auth/after-restore";
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

/** Where the session is stored: supabase-js's own default, named so a launch can read it early. */
export const AUTH_STORAGE_KEY = authStorageKey(supabaseUrl);

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Required for React Native
  },
  global: { fetch: timedFetch },
});

/** The signed-in user's id from the stored session: no network round trip, and never signs anyone in. */
export async function sessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
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
