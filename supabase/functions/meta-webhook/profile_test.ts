import { assertEquals } from "jsr:@std/assert@1.0.6";
import { MetaError } from "../_shared/meta.ts";
import { type Deps, type Profile, refreshProfile } from "./profile.ts";

function fake(opts: { due?: boolean; profile?: () => Promise<Profile> } = {}) {
  const graphCalls: string[] = [];
  const saved: unknown[][] = [];
  const deps: Deps = {
    claim: () => Promise.resolve(opts.due ?? true),
    getPageToken: () => Promise.resolve("page-token"),
    fetchProfile: (psid) => {
      graphCalls.push(psid);
      return (opts.profile ?? (() => Promise.resolve({ name: "Nguyen An", profile_pic: "https://cdn.example/a.jpg" })))();
    },
    save: (...args) => (saved.push(args), Promise.resolve()),
  };
  return { deps, graphCalls, saved };
}

function captureErrors(): { lines: unknown[][]; restore: () => void } {
  const original = console.error;
  const lines: unknown[][] = [];
  console.error = (...args: unknown[]) => lines.push(args);
  return { lines, restore: () => (console.error = original) };
}

Deno.test("a due lookup saves the Graph name and picture", async () => {
  const { deps, graphCalls, saved } = fake();
  await refreshProfile(deps, "p1", "u1");
  assertEquals(graphCalls, ["u1"]);
  assertEquals(saved, [["p1", "u1", "Nguyen An", "https://cdn.example/a.jpg"]]);
});

Deno.test("a Graph error leaves the row unchanged and logs once", async () => {
  const { deps, saved } = fake({ profile: () => Promise.reject(new MetaError("permission_denied", "no access")) });
  const errors = captureErrors();
  try {
    await refreshProfile(deps, "p1", "u1");
  } finally {
    errors.restore();
  }
  assertEquals(saved, []);
  assertEquals(errors.lines, [["profile: lookup failed", "permission_denied", "no access"]]);
});

Deno.test("a conversation with a fresh name skips Graph", async () => {
  const { deps, graphCalls, saved } = fake({ due: false });
  await refreshProfile(deps, "p1", "u1");
  assertEquals(graphCalls, []);
  assertEquals(saved, []);
});
