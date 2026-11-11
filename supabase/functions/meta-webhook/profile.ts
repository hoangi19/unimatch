// Fills a conversation's customer name and picture from the Graph API. Runs in the background
// next to the bot; every failure is logged once and swallowed so it never blocks a reply.
import { MetaError } from "../_shared/meta.ts";

export type Profile = { name?: string; profile_pic?: string };

export type Deps = {
  // Stamps the attempt and returns true when a lookup is due (see claim_customer_profile).
  claim: (pageId: string, psid: string) => Promise<boolean>;
  getPageToken: (pageId: string) => Promise<string | null>;
  fetchProfile: (psid: string, token: string) => Promise<Profile>;
  save: (pageId: string, psid: string, name: string | null, pictureUrl: string | null) => Promise<void>;
};

export async function refreshProfile(deps: Deps, pageId: string, psid: string): Promise<void> {
  try {
    if (!(await deps.claim(pageId, psid))) return;
    const token = await deps.getPageToken(pageId);
    if (!token) throw new Error("no Page token");
    const profile = await deps.fetchProfile(psid, token);
    await deps.save(pageId, psid, profile.name ?? null, profile.profile_pic ?? null);
  } catch (e) {
    const kind = e instanceof MetaError ? e.kind : "error";
    console.error("profile: lookup failed", kind, e instanceof Error ? e.message : String(e));
  }
}
