create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create table if not exists public.scan (
    id uuid primary key default gen_random_uuid(),
    business_input jsonb not null,
    place_id text,
    lat double precision,
    lng double precision,
    city text,
    cuisine text,
    status text not null default 'queued',
    score integer,
    dollar_impact integer,
    issues_json jsonb,
    insights_json jsonb,
    score_breakdown_json jsonb,
    top_issues jsonb,
    report_token text,
    report_token_expires_at timestamptz,
    created_at timestamptz not null default now(),
    created_date date not null default ((now() at time zone 'utc')::date),
    completed_at timestamptz
);

create index if not exists scan_place_id_idx on public.scan (place_id);
create unique index if not exists scan_place_id_daily_idx on public.scan (place_id, created_date);

create table if not exists public.lead (
    id bigserial primary key,
    scan_id uuid not null references public.scan(id) on delete cascade,
    name text,
    business text,
    phone text,
    verified boolean not null default false,
    airtable_id text,
    score integer,
    city text,
    cuisine text,
    top_issues jsonb,
    report_url text,
    created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists lead_scan_unique_idx on public.lead (scan_id);

create table if not exists public.competitor (
    id bigserial primary key,
    scan_id uuid not null references public.scan(id) on delete cascade,
    place_id text,
    name text,
    rating numeric,
    reviews integer,
    distance_m integer,
    rank_map_pack integer,
    rank_organic integer,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists competitor_scan_idx on public.competitor (scan_id);

alter table public.scan enable row level security;
alter table public.lead enable row level security;
alter table public.competitor enable row level security;

create policy "Allow service role full access" on public.scan
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Allow service role full access" on public.lead
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Allow service role full access" on public.competitor
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
