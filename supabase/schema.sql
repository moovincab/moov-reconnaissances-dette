-- MOOV'IN CAB — exécuter sur une base Supabase DÉDIÉE dans SQL Editor.
-- Aucun accès client direct aux données métier : toutes les opérations passent par les fonctions serveur authentifiées.
create extension if not exists pgcrypto;

create table if not exists public.staff (
 user_id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null,
 email text not null unique,
 role text not null check (role in ('admin','manager')) default 'manager',
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table if not exists public.records (
 id uuid primary key default gen_random_uuid(),
 ref text not null unique,
 created_by uuid references auth.users(id),
 assigned_to uuid references public.staff(user_id),
 state text not null check (state in ('draft','pending','signed','cancelled')) default 'draft',
 debtor_email text not null,
 debtor_name text not null,
 amount_cents bigint not null check (amount_cents>0),
 data jsonb not null default '{}'::jsonb,
 sign_token_hash text unique,
 sign_expires_at timestamptz,
 invited_at timestamptz,
 signed_at timestamptz,
 sign_ip text,
 sign_user_agent text,
 signature jsonb,
 pdf_path text,
 pdf_sha256 text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists records_due_idx on public.records(state,assigned_to);
create table if not exists public.installments (
 id uuid primary key default gen_random_uuid(),
 record_id uuid not null references public.records(id) on delete cascade,
 seq integer not null,
 due_date date not null,
 amount_cents bigint not null check(amount_cents>0),
 paid_at timestamptz,
 paid_note text,
 updated_by uuid references auth.users(id),
 unique(record_id,seq)
);
create index if not exists installments_pending_idx on public.installments(due_date) where paid_at is null;
create table if not exists public.events (
 id bigint generated always as identity primary key,
 record_id uuid not null references public.records(id) on delete cascade,
 event_type text not null,
 by_user uuid references auth.users(id),
 details jsonb not null default '{}'::jsonb,
 occurred_at timestamptz not null default now()
);
create table if not exists public.reminder_logs (
 id bigint generated always as identity primary key,
 installment_id uuid not null references public.installments(id) on delete cascade,
 reminder_type text not null,
 recipient text not null,
 resend_id text,
 sent_at timestamptz not null default now(),
 unique(installment_id,reminder_type,recipient)
);

alter table public.staff enable row level security;
alter table public.records enable row level security;
alter table public.installments enable row level security;
alter table public.events enable row level security;
alter table public.reminder_logs enable row level security;
revoke all on public.staff, public.records, public.installments, public.events, public.reminder_logs from anon, authenticated;
revoke all on public.staff, public.records, public.installments, public.events, public.reminder_logs from public;
-- La clé serveur contourne RLS. Ne la saisissez jamais côté navigateur.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('debt-archives','debt-archives',false,10485760,array['application/pdf'])
on conflict (id) do nothing;

-- INITIALISATION ADMIN : après avoir créé votre compte dans Authentication > Users,
-- remplacez l'adresse ci-dessous et exécutez la requête séparément :
-- insert into public.staff(user_id,full_name,email,role)
-- select id,'Viktor','votre-adresse@entreprise.fr','admin' from auth.users
-- where email='votre-adresse@entreprise.fr'
-- on conflict(user_id) do update set role='admin',active=true;
