/** Whether this build has the Supabase project set (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY). Kept apart from
 *  supabase-api.ts so screens can ask without pulling the (large) Supabase client into the first download. */
export const cloudConfigured = Boolean((import.meta.env.VITE_SUPABASE_URL || '').trim() && (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim());
