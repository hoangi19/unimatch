# UniMatch

Admin console for a Facebook Page chatbot that answers job questions. Board: https://github.com/users/hoangi19/projects/4 (issues in `hoangi19/unimatch`, written in Vietnamese).

## Stack (decided)

- **Frontend:** Vite + React + TypeScript + Tailwind, built to static files, served by Cloudflare Pages project `unimatch` (`unimatch-1va.pages.dev`). Prototype and visual spec: `demo/index.html`, tokens and rules: `design-system/unimatch/MASTER.md`.
- **Backend:** Supabase project `hsuxhzalvshmbmiuyhwl` (Singapore): Postgres + pgvector, Auth (email + password, sign-up off), Vault, Realtime, Edge Functions (Deno/TypeScript).
- **Webhook:** Supabase Edge Function `meta-webhook` (not a Cloudflare Worker). Callback `https://hsuxhzalvshmbmiuyhwl.supabase.co/functions/v1/meta-webhook`.
- **AI:** provider is selectable (Hermes, OpenAI, Claude, custom OpenAI-compatible). Keys live in Supabase Vault, never in the browser.
- **Out of scope for now:** the Dataset tab (LinkedIn crawl, embeddings, job search) and PostHog.

## Environments

One environment only: GitHub Environment `production` holds every secret and variable for CI. There is no separate dev project; test against the hosted project and clean up what tests create. Do not run a local Supabase stack.

## Live testing

- Meta app `uniagent` (`1781999639695661`), Page "UniMatch - Giải pháp hỗ trợ sinh viên tìm việc làm" (`1531275346725506`).
- Send real test messages with claude-in-chrome at https://www.facebook.com/messages/t/1531275346725506 (owner's signed-in Chrome). One tab at a time.
- Admin test login: `admin@unimatch.test`, password in macOS Keychain service `unimatch-test-login` (`security find-generic-password -s unimatch-test-login -w`). Never print or store it.
- Never print tokens or secrets, never type secrets into web forms, never buy anything.

## Conventions

- Code, comments, commits, PRs and docs in English. Commits have no ticket IDs. PR title: `[#<issue>] <type>: <summary>`.
- One migration file per PR, created with `supabase migration new <name>`.
- Work in `.worktrees/issue-<n>` on branch `feat/issue-<n>-<slug>` from `origin/main`.
