import type { SupabaseClient } from '@supabase/supabase-js';

let instance: Promise<SupabaseClient> | undefined;
let adminInstance: Promise<SupabaseClient> | undefined;
export const ADMIN_AUTH_STORAGE_KEY = 'hexfortia-admin-auth';
export function browserSupabase(): Promise<SupabaseClient> | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return (instance ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, key),
  ));
}

export function adminSupabase(): Promise<SupabaseClient> | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return (adminInstance ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, key, {
      auth: {
        storageKey: ADMIN_AUTH_STORAGE_KEY,
        storage: window.sessionStorage,
        detectSessionInUrl: false,
      },
    }),
  ));
}
