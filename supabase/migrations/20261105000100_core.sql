-- Daldal core schema: shops, members, shop state, audit, idempotency.
--
-- Security model
--   * Clients (anon / authenticated) never write any table directly. Every change goes through
--     /api (Vercel Functions), which authenticates the user, loads their role from
--     shop_members, applies the domain rules (src/domain) and commits via
--     public.commit_shop_action() using the service role.
--   * shop_state is NOT readable by clients either: the JSON document contains finance data
--     (expenses, prices) that staff must not see. /api/state returns a role-filtered view.
--   * RLS is enabled on every table; the policies below only grant narrow reads.

create type public.member_role as enum ('owner', 'manager', 'staff');

-- ── Shops and membership ────────────────────────────────────────────
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.shop_members (
  shop_id uuid not null references public.shops (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  -- Shown in history and matched against the configured approver / expense reviewer.
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id),
  unique (shop_id, display_name)
);
create index shop_members_user_idx on public.shop_members (user_id);

-- ── Shop state: the domain document (schemaVersion 6) per shop ─────────
-- revision is the optimistic-concurrency token; it always equals data->>'revision'.
create table public.shop_state (
  shop_id uuid primary key references public.shops (id) on delete cascade,
  revision bigint not null check (revision >= 0),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint shop_state_document check (
    jsonb_typeof(data) = 'object'
    and data ->> 'schemaVersion' = '6'
    and (data ->> 'revision')::bigint = revision
  )
);

-- ── Audit log (append-only) ──────────────────────────────────────────
create table public.audit_log (
  id bigint generated always as identity primary key,
  shop_id uuid not null references public.shops (id),
  actor_id uuid references auth.users (id) on delete set null,
  actor_role public.member_role,
  action text not null check (char_length(action) between 1 and 100),
  payload jsonb not null default '{}'::jsonb,
  revision_before bigint,
  revision_after bigint,
  at timestamptz not null default now()
);
create index audit_log_shop_at_idx on public.audit_log (shop_id, at desc);

create function public.audit_log_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end $$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();

-- ── Idempotency: a retried request (same key) never applies twice ────
create table public.idempotency_keys (
  shop_id uuid not null references public.shops (id) on delete cascade,
  key text not null check (char_length(key) between 8 and 100),
  action text not null,
  revision_after bigint not null,
  created_at timestamptz not null default now(),
  primary key (shop_id, key)
);

-- ── Membership helpers (used by RLS) ─────────────────────────────────
create function public.shop_role(p_shop uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.shop_members m
  where m.shop_id = p_shop and m.user_id = auth.uid() and m.active
$$;

create function public.is_shop_member(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.shop_role(p_shop) is not null
$$;

-- Owners and managers see finance (mirrors domain can(role, 'expense')).
create function public.is_shop_reviewer(p_shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.shop_role(p_shop) in ('owner', 'manager'), false)
$$;

-- ── Privileges + RLS ─────────────────────────────────────────────────
-- Supabase grants ALL on new public tables to anon/authenticated by default; take it back
-- and grant only the reads the policies allow.
revoke all on public.shops, public.shop_members, public.shop_state, public.audit_log,
  public.idempotency_keys from anon, authenticated;

alter table public.shops enable row level security;
alter table public.shop_members enable row level security;
alter table public.shop_state enable row level security;
alter table public.audit_log enable row level security;
alter table public.idempotency_keys enable row level security;

grant select on public.shops, public.shop_members to authenticated;
grant select on public.audit_log to authenticated;

create policy "members read their shop" on public.shops
  for select to authenticated using (public.is_shop_member(id));

create policy "members read colleagues" on public.shop_members
  for select to authenticated using (public.is_shop_member(shop_id));

create policy "reviewers read audit" on public.audit_log
  for select to authenticated using (public.is_shop_reviewer(shop_id));

-- shop_state, idempotency_keys: no client policies at all (service role only).
