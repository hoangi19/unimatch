// SSRF guard: the provider key may only go to a public https host. Run it before the key is loaded.
// shortcut: checks DNS once, then fetch resolves again (DNS rebinding gap), accepted in docs/security.md.
import { AiError } from "./chat.ts";

export type Resolve = (host: string, type: "A" | "AAAA") => Promise<string[]>;

const resolveDns: Resolve = (host, type) => Deno.resolveDns(host, type);

const PUBLIC_ONLY = "Base URL must be a public https address";

export async function assertPublicHost(baseUrl: string, resolve: Resolve = resolveDns): Promise<void> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AiError("bad_config", PUBLIC_ONLY);
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new AiError("bad_config", PUBLIC_ONLY);

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIp(host)) {
    if (isPrivate(host)) throw new AiError("bad_config", PUBLIC_ONLY);
    return;
  }

  let addresses: string[];
  try {
    const found = await Promise.allSettled([resolve(host, "A"), resolve(host, "AAAA")]);
    addresses = found.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  } catch {
    addresses = [];
  }
  // Fail closed: no answer (or no DNS in this runtime) means the host cannot be checked.
  if (!addresses.length) throw new AiError("bad_config", "Cannot verify provider host");
  if (addresses.some(isPrivate)) throw new AiError("bad_config", PUBLIC_ONLY);
}

function isIp(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

// Loopback, private, CGNAT, link-local (cloud metadata), multicast, reserved and their IPv6 forms.
export function isPrivate(ip: string): boolean {
  if (ip.includes(":")) return isPrivateV6(ip.toLowerCase());
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19));
}

function isPrivateV6(ip: string): boolean {
  // IPv4-mapped or NAT64 (::ffff:a.b.c.d, 64:ff9b::a.b.c.d) take the IPv4 rules.
  const v4 = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (v4) return isPrivate(v4);
  const words = expand(ip);
  if (!words) return true;
  const [w0] = words;
  if (words.every((w) => w === 0) || (words.slice(0, 7).every((w) => w === 0) && words[7] === 1)) return true; // :: and ::1
  if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) return true; // ::ffff:hex form
  if (w0 === 0x64 && words[1] === 0xff9b) return true; // NAT64 in hex form
  return (w0 & 0xfe00) === 0xfc00 || (w0 & 0xffc0) === 0xfe80 || (w0 & 0xff00) === 0xff00 || w0 === 0x2001 && words[1] === 0xdb8;
}

// Eight 16-bit words, or null when the text is not an IPv6 address.
function expand(ip: string): number[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const parts = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...tail];
  if (parts.length !== 8 || !parts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}
