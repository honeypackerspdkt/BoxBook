/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth client ids for Drive backup (public values; see CLAUDE.md). */
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
  readonly VITE_GOOGLE_ANDROID_CLIENT_ID?: string;
  readonly VITE_GOOGLE_IOS_CLIENT_ID?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SHOP_URL?: string;
}
