import type { SupabaseClient } from '@supabase/supabase-js';

let instance: Promise<SupabaseClient> | undefined;
export function browserSupabase(): Promise<SupabaseClient> | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return (instance ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, key),
  ));
}
