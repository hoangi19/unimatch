import { createClient } from '@supabase/supabase-js'
import { readEnv } from '../env'
import type { Database } from './database.types'

const { supabaseUrl, publishableKey } = readEnv()
if (!supabaseUrl || !publishableKey) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see web/.env.example)')

// The session is kept in localStorage and its token refreshes itself (supabase-js defaults).
export const supabase = createClient<Database>(supabaseUrl, publishableKey)
