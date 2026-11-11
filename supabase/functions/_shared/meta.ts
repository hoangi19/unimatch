// Graph API calls for Edge Functions. Errors never carry the access token.
import { GRAPH_VERSION } from "./graph.ts";

// Public id of the Meta app `uniagent`; not a secret.
export const META_APP_ID = "1781999639695661";

export type MetaErrorKind =
  | "bad_config" // our side is missing config, for example META_APP_SECRET
  | "token_expired" // OAuthException 190: token expired, revoked or invalid
  | "permission_denied" // missing permission or Page role for this call
  | "rate_limit"
  | "bad_request"
  | "graph"; // any other Graph or network failure

export class MetaError extends Error {
  constructor(readonly kind: MetaErrorKind, message: string) {
    super(message);
    this.name = "MetaError";
  }
}

type GraphErrorBody = { error?: { message?: string; code?: number; error_subcode?: number } };

export function graphErrorKind(code: number | undefined, status: number): MetaErrorKind {
  if (code === 190 || code === 102) return "token_expired";
  // 3: app lacks the capability, 10 and 200-299: permission not granted.
  if (code === 3 || code === 10 || (code !== undefined && code >= 200 && code < 300)) return "permission_denied";
  if (code === 4 || code === 17 || code === 32 || code === 613) return "rate_limit";
  if (code === 100) return "bad_request";
  return status === 401 ? "token_expired" : status === 403 ? "permission_denied" : "graph";
}

// Calls https://graph.facebook.com/<version>/<path>. Params go in the query string for GET/DELETE and in a form body for POST.
export async function graph<T>(
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" | "DELETE" = "GET",
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path.replace(/^\//, "")}`);
  const init: RequestInit = { method, signal: AbortSignal.timeout(15_000) };
  if (method === "POST") init.body = new URLSearchParams(params);
  else for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    throw new MetaError("graph", "Could not reach Facebook");
  }
  const body = await res.json().catch(() => null) as (T & GraphErrorBody) | null;
  if (res.ok && body && !body.error) return body;
  const err = body?.error;
  // Graph messages describe the failure, not the token; still strip anything token-shaped.
  const message = (err?.message ?? `Facebook returned HTTP ${res.status}`).replace(/EA[A-Za-z0-9]{20,}/g, "[token]");
  throw new MetaError(graphErrorKind(err?.code, res.status), message);
}
