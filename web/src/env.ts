export type WebEnv = { supabaseUrl: string | null; hasPublishableKey: boolean }

export function readEnv(env: Record<string, string | undefined> = import.meta.env): WebEnv {
  return {
    supabaseUrl: env.VITE_SUPABASE_URL?.trim() || null,
    hasPublishableKey: Boolean(env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()),
  }
}
