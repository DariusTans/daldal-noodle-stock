-- New Supabase projects no longer grant public tables to the API roles automatically, and that
-- includes service_role. /api reaches these tables directly through supabase-js, so grant exactly
-- what src/server/supabase.ts uses. Writes to shop_state, audit_log and idempotency_keys go only
-- through the security definer RPCs.
grant select on public.shops to service_role;
grant select, insert, update on public.shop_members to service_role;
grant select on public.shop_state to service_role;
grant select on public.idempotency_keys to service_role;
grant select, insert, update on public.evidence to service_role;
