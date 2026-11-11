// Facebook JS SDK loader and Facebook Login for Business. Returns a short-lived user token for the `pages` function.

// Keep in sync with supabase/functions/_shared/graph.ts.
export const GRAPH_VERSION = 'v24.0'
const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js'

type AuthResponse = { accessToken: string }
type LoginResponse = { status: 'connected' | 'not_authorized' | 'unknown'; authResponse: AuthResponse | null }
export type FacebookSdk = {
  init(params: { appId: string; version: string; xfbml?: boolean; cookie?: boolean }): void
  login(callback: (res: LoginResponse) => void, options: { config_id: string }): void
}

declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

export class FacebookLoginError extends Error {
  readonly kind: 'cancelled' | 'sdk'
  constructor(kind: 'cancelled' | 'sdk', message: string) {
    super(message)
    this.kind = kind
  }
}

let sdk: Promise<FacebookSdk> | null = null

export function loadFacebookSdk(appId: string = import.meta.env.VITE_META_APP_ID ?? ''): Promise<FacebookSdk> {
  sdk ??= new Promise<FacebookSdk>((resolve, reject) => {
    if (!appId) return reject(new FacebookLoginError('sdk', 'VITE_META_APP_ID is not set'))
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, version: GRAPH_VERSION, xfbml: false, cookie: false })
      resolve(window.FB!)
    }
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.crossOrigin = 'anonymous'
    script.onerror = () => reject(new FacebookLoginError('sdk', 'Could not load the Facebook SDK'))
    document.head.append(script)
  }).catch((e: unknown) => {
    sdk = null // let the next call retry, for example after an ad blocker is turned off
    throw e
  })
  return sdk
}

// Opens the Facebook Login popup. Call from a click handler, and call loadFacebookSdk() earlier (on tab mount)
// so the SDK is ready and the browser does not block the popup.
export async function facebookLogin(
  configId: string = import.meta.env.VITE_META_LOGIN_CONFIG_ID ?? '',
  load: () => Promise<FacebookSdk> = loadFacebookSdk,
): Promise<string> {
  if (!configId) throw new FacebookLoginError('sdk', 'VITE_META_LOGIN_CONFIG_ID is not set')
  const fb = await load()
  return new Promise((resolve, reject) =>
    fb.login((res) => {
      if (res.status === 'connected' && res.authResponse?.accessToken) resolve(res.authResponse.accessToken)
      else reject(new FacebookLoginError('cancelled', 'Facebook Login was cancelled or not authorized'))
    }, { config_id: configId }),
  )
}
