import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://ojntnbaakfowmnrsetbb.supabase.co";
export const AUTH_STORAGE_KEY = "rsi.auth";
export const LEGACY_LLM_KEY = "rsi.llm";

/** Refresh tokens stay in localStorage. The client refreshes the access token on its own. */
export const AUTH_OPTIONS = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  storageKey: AUTH_STORAGE_KEY,
} as const;

let client: SupabaseClient | null = null;

export function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() || SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!anonKey) return null;
  return { url, anonKey };
}

export function getSupabase(): SupabaseClient | null {
  const config = supabaseConfig();
  if (!config) return null;
  if (!client) {
    client = createClient(config.url, config.anonKey, {
      auth: {
        ...AUTH_OPTIONS,
        storage: typeof window === "undefined" ? undefined : window.localStorage,
      },
    });
  }
  return client;
}

/** Passcodes and pasted xAI keys from the previous desk are removed. */
export function forgetLegacySecrets(store: Pick<Storage, "removeItem"> | null): void {
  store?.removeItem(LEGACY_LLM_KEY);
}
