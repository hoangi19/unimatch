-- Job postings imported by scripts/import-jobs.ts. Admins read; only service_role writes.
-- Personal data (contact, poster name and profile) stays in raw, not in typed columns.
create table public.jobs (
  source text not null check (source ~ '^[a-z][a-z0-9_]*$'),
  external_id text not null,
  source_name text,
  title text not null,
  company_name text,
  company_linkedin_url text,
  company_logo text,
  location text,
  salary text,
  employment_type text,
  seniority_level text,
  industries text,
  description_text text,
  description_html text,
  link text,
  apply_url text,
  applicants_count int,
  benefits text[] not null default '{}',
  posted_at date,
  scraped_at timestamptz,
  raw jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source, external_id)
);

alter table public.jobs enable row level security;
create policy "admins read jobs" on public.jobs for select to authenticated using ((select public.is_admin()));

revoke all on public.jobs from anon, authenticated;
grant select on public.jobs to authenticated;
