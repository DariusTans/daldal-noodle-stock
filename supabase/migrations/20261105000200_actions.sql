-- Server-side write path. Only the service role (Vercel Functions) may execute these.
--
-- The API computes the next document with the domain (src/domain, pure + validated) and
-- commits it here atomically:
--   * optimistic concurrency: the update only applies if revision = p_expected_revision
--   * the actor must be an active member with the claimed role (defence in depth)
--   * an audit row and the idempotency key are written in the same transaction
-- Result: {"status": "committed" | "conflict" | "replayed", "revision": <current revision>}

create function public.bootstrap_shop(
  p_owner uuid,
  p_shop_name text,
  p_display_name text,
  p_initial jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  insert into public.shops (name) values (btrim(p_shop_name)) returning id into v_shop;
  insert into public.shop_members (shop_id, user_id, role, display_name)
    values (v_shop, p_owner, 'owner', btrim(p_display_name));
  insert into public.shop_state (shop_id, revision, data, updated_by)
    values (v_shop, (p_initial ->> 'revision')::bigint, p_initial, p_owner);
  insert into public.audit_log (shop_id, actor_id, actor_role, action, payload, revision_after)
    values (v_shop, p_owner, 'owner', 'bootstrapShop', jsonb_build_object('name', btrim(p_shop_name)),
            (p_initial ->> 'revision')::bigint);
  return v_shop;
end $$;

create function public.commit_shop_action(
  p_shop uuid,
  p_actor uuid,
  p_role public.member_role,
  p_action text,
  p_payload jsonb,
  p_expected_revision bigint,
  p_next jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_revision bigint;
  v_next_revision bigint := (p_next ->> 'revision')::bigint;
  v_replayed bigint;
begin
  if not exists (
    select 1 from public.shop_members m
    where m.shop_id = p_shop and m.user_id = p_actor and m.role = p_role and m.active
  ) then
    raise exception 'actor is not an active % of shop %', p_role, p_shop using errcode = '42501';
  end if;

  if p_idempotency_key is not null then
    select k.revision_after into v_replayed from public.idempotency_keys k
      where k.shop_id = p_shop and k.key = p_idempotency_key;
    if found then
      return jsonb_build_object('status', 'replayed', 'revision', v_replayed);
    end if;
  end if;

  if v_next_revision is null or v_next_revision <= p_expected_revision then
    raise exception 'next revision (%) must be greater than %', v_next_revision, p_expected_revision
      using errcode = '22023';
  end if;

  update public.shop_state
    set data = p_next, revision = v_next_revision, updated_at = now(), updated_by = p_actor
    where shop_id = p_shop and revision = p_expected_revision
    returning revision into v_revision;

  if not found then
    select s.revision into v_revision from public.shop_state s where s.shop_id = p_shop;
    if not found then
      raise exception 'shop % has no state', p_shop using errcode = 'P0002';
    end if;
    return jsonb_build_object('status', 'conflict', 'revision', v_revision);
  end if;

  insert into public.audit_log (shop_id, actor_id, actor_role, action, payload, revision_before, revision_after)
    values (p_shop, p_actor, p_role, p_action, coalesce(p_payload, '{}'::jsonb), p_expected_revision, v_revision);

  if p_idempotency_key is not null then
    insert into public.idempotency_keys (shop_id, key, action, revision_after)
      values (p_shop, p_idempotency_key, p_action, v_revision);
  end if;

  return jsonb_build_object('status', 'committed', 'revision', v_revision);
end $$;

-- Supabase grants EXECUTE on new functions to anon/authenticated by default.
revoke execute on function public.bootstrap_shop(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.commit_shop_action(uuid, uuid, public.member_role, text, jsonb, bigint, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_shop(uuid, text, text, jsonb) to service_role;
grant execute on function public.commit_shop_action(uuid, uuid, public.member_role, text, jsonb, bigint, jsonb, text)
  to service_role;
