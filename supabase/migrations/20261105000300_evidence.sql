-- Evidence files (bill / receipt photos and PDFs) live in the private "evidence" bucket,
-- replacing the prototype's base64 data URLs inside the state document.
--
-- Object path: <shop_id>/<evidence_id>   (first folder = shop, used by the storage policy)
-- Uploads use signed upload URLs issued by /api (service role) after checking the role;
-- downloads use short-lived signed URLs, or the read policy below for owners/managers.

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops (id) on delete cascade,
  object_path text not null unique,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  original_name text not null check (char_length(btrim(original_name)) between 1 and 160),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- the same file uploaded twice is the same evidence (duplicate-bill detection uses the hash)
  unique (shop_id, sha256),
  constraint evidence_path_in_shop check (object_path like shop_id::text || '/%')
);

revoke all on public.evidence from anon, authenticated;
alter table public.evidence enable row level security;
grant select on public.evidence to authenticated;

create policy "reviewers read evidence metadata" on public.evidence
  for select to authenticated using (public.is_shop_reviewer(shop_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Finance evidence is visible to owners/managers of the shop that owns the folder.
create policy "reviewers read shop evidence" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidence'
    -- CASE guarantees the uuid cast only runs on well-formed folder names
    and public.is_shop_reviewer(
      case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then ((storage.foldername(name))[1])::uuid
      end
    )
  );
