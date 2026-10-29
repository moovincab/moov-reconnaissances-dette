-- MOOV IN CAB — créanciers multiples et champs du modèle de reconnaissance de dette.
-- Migration additive : ne remplace pas la migration initiale et ne supprime aucune donnée.

create table if not exists public.creditors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  siren text not null default '',
  representative text not null default '',
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists creditors_one_default_idx
  on public.creditors (is_default) where is_default = true;
create index if not exists creditors_name_idx on public.creditors (lower(name));

alter table public.creditors enable row level security;
revoke all privileges on table public.creditors from anon, authenticated;

insert into public.creditors (name, address, siren, representative, is_default)
select 'MOOV IN CAB', '1 Place Paul Verlaine, 92100 Boulogne-Billancourt', '494179377',
       'M. Nicolas VEDOVATO, en qualité de représentant légal', true
where not exists (select 1 from public.creditors where is_default = true);

alter table public.debts add column if not exists creditor_id uuid references public.creditors(id) on delete set null;
alter table public.debts add column if not exists creditor_siren text not null default '';
alter table public.debts add column if not exists creditor_representative text not null default '';
alter table public.debts add column if not exists debtor_phone text not null default '';
alter table public.debts add column if not exists vehicle text not null default '';
alter table public.debts add column if not exists vehicle_registration text not null default '';
alter table public.debts add column if not exists rental_contract_signed_at date;
alter table public.debts add column if not exists repayment_mode text not null default 'installments'
  check (repayment_mode in ('cash', 'installments'));
alter table public.debts add column if not exists cash_due_date date;
alter table public.debts add column if not exists contract_sha256 text;
alter table public.signature_events add column if not exists contract_sha256 text;

-- Complète les reconnaissances historiques MOOV IN CAB sans écraser les valeurs déjà saisies.
update public.debts
set creditor_address = case when creditor_address = '' then '1 Place Paul Verlaine, 92100 Boulogne-Billancourt' else creditor_address end,
    creditor_siren = case when creditor_siren = '' then '494179377' else creditor_siren end,
    creditor_representative = case when creditor_representative = '' then 'M. Nicolas VEDOVATO, en qualité de représentant légal' else creditor_representative end
where creditor_name = 'MOOV IN CAB';

update public.debts d
set creditor_id = c.id
from public.creditors c
where c.is_default = true and d.creditor_id is null and d.creditor_name = c.name;
