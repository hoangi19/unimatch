import { assertEquals } from "jsr:@std/assert@1.0.6";
import { withCors } from "./cors.ts";

const handle = withCors(() => Promise.resolve(Response.json({ ok: true })));
const origin = async (method: string, from: string) =>
  (await handle(new Request("http://localhost/fn", { method, headers: { origin: from } }))).headers.get("access-control-allow-origin");

Deno.test("the console, its previews and localhost are allowed", async () => {
  for (const o of ["https://unimatch-1va.pages.dev", "https://feat-x.unimatch-1va.pages.dev", "http://localhost:5173", "http://127.0.0.1:4173"]) {
    assertEquals(await origin("OPTIONS", o), o);
    assertEquals(await origin("POST", o), o);
  }
});

Deno.test("other origins get no allow-origin header", async () => {
  for (const o of ["https://evil.example", "https://unimatch-1va.pages.dev.evil.example", "https://evilunimatch-1va.pages.dev", "http://unimatch-1va.pages.dev"]) {
    assertEquals(await origin("OPTIONS", o), null);
    assertEquals(await origin("POST", o), null);
  }
});

Deno.test("preflight is answered without calling the handler", async () => {
  let called = false;
  const res = await withCors(() => { called = true; return Promise.resolve(new Response()); })(new Request("http://localhost/fn", { method: "OPTIONS" }));
  assertEquals([res.status, called], [204, false]);
});
