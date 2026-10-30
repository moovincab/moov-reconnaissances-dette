-- MOOV IN CAB — durcissement RLS additif.
-- Les écritures métier continuent de passer par les Edge Functions authentifiées.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  );
$$;
revoke all privileges on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.debts enable row level security;
alter table public.installments enable row level security;
alter table public.signature_requests enable row level security;
alter table public.signature_events enable row level security;

 drop policy if exists "authenticated read profiles" on public.profiles;
 drop policy if exists "authenticated read debts" on public.debts;
 drop policy if exists "authenticated read installments" on public.installments;
 drop policy if exists "profiles read self or admin" on public.profiles;
 drop policy if exists "debts read authorized" on public.debts;
 drop policy if exists "installments read authorized debts" on public.installments;

create policy "profiles read self or admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

create policy "debts read authorized"
  on public.debts for select to authenticated
  using (
    public.is_admin()
    or created_by = (select auth.uid())
    or assigned_to = (select auth.uid())
  );

create policy "installments read authorized debts"
  on public.installments for select to authenticated
  using (exists (select 1 from public.debts d where d.id = installments.debt_id));

revoke all privileges on table public.profiles, public.debts, public.installments,
  public.signature_requests, public.signature_events from anon, authenticated;
grant select on table public.profiles, public.debts, public.installments to authenticated;
