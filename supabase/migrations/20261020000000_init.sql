-- MOOV IN CAB — schema initiale. Exécuter dans Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'staff' check (role in ('admin','staff')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'full_name',''), 'staff')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  creditor_name text not null default 'MOOV IN CAB',
  creditor_address text not null default '',
  debtor_name text not null,
  debtor_email text not null,
  debtor_address text not null default '',
  amount numeric(12,2) not null check (amount > 0),
  amount_in_words text not null,
  currency text not null default 'EUR' check (currency = 'EUR'),
  reason text not null,
  frequency text not null check (frequency in ('weekly','monthly')),
  installment_count integer not null check (installment_count between 1 and 60),
  status text not null default 'pending_signature' check (status in ('pending_signature','signed','repaid')),
  debtor_dob date,
  signed_at timestamptz,
  signed_pdf_path text,
  pdf_sha256 text,
  signature_ip text,
  signature_user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.installments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete cascade,
  sequence_no integer not null,
  due_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','paid')),
  paid_at timestamptz,
  reminder_stage integer not null default 0,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  unique(debt_id, sequence_no)
);
create index if not exists installments_due_idx on public.installments(status, due_date);
create index if not exists debts_status_idx on public.debts(status, created_at desc);

-- Le jeton en clair n'est jamais stocké : seul son SHA-256 est conservé.
create table if not exists public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  signed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.signature_events (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references public.debts(id) on delete cascade,
  event_type text not null,
  debtor_dob date,
  acceptance_text text,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.debts enable row level security;
alter table public.installments enable row level security;
alter table public.signature_requests enable row level security;
alter table public.signature_events enable row level security;

drop policy if exists "authenticated read profiles" on public.profiles;
create policy "authenticated read profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "authenticated read debts" on public.debts;
create policy "authenticated read debts" on public.debts for select to authenticated using (true);
drop policy if exists "authenticated read installments" on public.installments;
create policy "authenticated read installments" on public.installments for select to authenticated using (true);
-- Pas de politique client pour signature_requests/signature_events : accès Edge Function avec service_role seulement.
grant select on public.profiles, public.debts, public.installments to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signed-debt-documents', 'signed-debt-documents', false, 15000000, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 15000000, allowed_mime_types = array['application/pdf'];
-- Ne créez aucune policy Storage publique. Les PDF sont servis par URL signée temporaire.
