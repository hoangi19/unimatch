import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.6";
import { AiError } from "./chat.ts";
import { assertPublicHost, isPrivate, type Resolve } from "./host.ts";

const dns = (records: Record<string, string[]>): Resolve => (host, type) => {
  const found = (records[host] ?? []).filter((ip) => ip.includes(":") === (type === "AAAA"));
  return found.length ? Promise.resolve(found) : Promise.reject(new Error("NXDOMAIN"));
};

Deno.test("isPrivate covers loopback, private, link-local, CGNAT and IPv6 forms", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe"]) {
    assertEquals(isPrivate(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "104.18.6.192", "172.32.0.1", "100.128.0.1", "2606:4700::1111"]) {
    assertEquals(isPrivate(ip), false, ip);
  }
});

Deno.test("public https hosts pass", async () => {
  await assertPublicHost("https://api.openai.com/v1", dns({ "api.openai.com": ["104.18.6.192", "2606:4700::6812:6c0"] }));
  await assertPublicHost("https://8.8.8.8/v1", dns({}));
});

Deno.test("http, credentials, private IPs and private DNS answers are blocked", async () => {
  const resolve = dns({ "evil.example": ["93.184.216.34", "10.0.0.5"], "meta.example": ["169.254.169.254"] });
  for (const url of ["http://api.openai.com/v1", "https://user:pw@api.openai.com", "https://127.0.0.1/v1", "https://[::1]/v1", "https://evil.example/v1", "https://meta.example", "not a url"]) {
    const e = await assertRejects(() => assertPublicHost(url, resolve), AiError);
    assertEquals(e.message, "Base URL must be a public https address", url);
  }
});

Deno.test("a host that cannot be resolved fails closed with its own message", async () => {
  for (const resolve of [dns({}), (() => { throw new TypeError("Deno.resolveDns is not a function"); }) as Resolve]) {
    const e = await assertRejects(() => assertPublicHost("https://inference-api.nousresearch.com/v1", resolve), AiError);
    assertEquals(e.message, "Cannot verify provider host");
  }
});
