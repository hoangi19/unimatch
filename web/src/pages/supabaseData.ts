import { readEnv } from '../env'
import { facebookLogin, loadFacebookSdk } from '../lib/facebook'
import { connectPage, disconnectPage, listPages, type PagesResult } from '../lib/pages'
import { supabase } from '../lib/supabase'
import { PAGE_COLUMNS, type PagesData } from './data'

const unauthorized = { ok: false, error: { kind: 'unauthorized', message: 'Sign in required' } } as const

/** Calls `fn` with the admin's current access token, or returns `unauthorized` when signed out. */
async function withToken<T>(fn: (token: string) => Promise<PagesResult<T>>): Promise<PagesResult<T>> {
  const token = (await supabase.auth.getSession()).data.session?.access_token
  return token ? fn(token) : unauthorized
}

export const supabasePagesData: PagesData = {
  async loadRows() {
    const { data, error } = await supabase.from('pages').select(PAGE_COLUMNS).order('connected_at')
    if (error) throw new Error(error.message)
    return data
  },
  async updatePage(id, patch) {
    const { data, error } = await supabase.from('pages').update(patch).eq('id', id).select('id')
    if (error) throw new Error(error.message)
    if (!data.length) throw new Error('Page not found')
  },
  loadSdk: () => loadFacebookSdk(),
  login: () => facebookLogin(),
  listPages: (userToken) => withToken((token) => listPages(token, userToken)),
  connectPage: (userToken, pageId) => withToken((token) => connectPage(token, userToken, pageId)),
  disconnectPage: (pageId) => withToken((token) => disconnectPage(token, pageId)),
  webhookUrl: `${readEnv().supabaseUrl}/functions/v1/meta-webhook`,
}
