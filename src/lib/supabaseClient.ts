import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const fallbackUrl = 'https://ysreenjwihmwzockyrls.supabase.co';
const fallbackPublishableKey = 'sb_publishable_M2aagozrBrtNnfZhbu9qrw_5Nhz5MN7';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? fallbackUrl;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? fallbackPublishableKey;

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

export function getSupabaseConfigStatus() {
  return {
    hasUrl: Boolean(supabaseUrl),
    hasPublishableKey: Boolean(supabasePublishableKey),
    url: supabaseUrl
  };
}
