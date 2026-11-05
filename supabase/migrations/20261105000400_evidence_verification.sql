-- An evidence row is created when /api issues the signed upload URL. The upload itself goes
-- straight to Storage, so the API re-reads the object once and checks size, sha-256 and file
-- signature before the file may be attached to an expense. verified_at records that check.
alter table public.evidence add column verified_at timestamptz;

create index evidence_shop_created_idx on public.evidence (shop_id, created_at desc);
