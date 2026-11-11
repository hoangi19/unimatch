export type WebEnv = { supabaseUrl: string | null; publishableKey: string | null }

export function readEnv(env: Record<string, string | undefined> = import.meta.env): WebEnv {
  return {
    supabaseUrl: env.VITE_SUPABASE_URL?.trim() || null,
    publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || null,
  }
}
