-- STEVE encrypted minute-bucket heart-rate archive. No names, medical notes or
-- plaintext BPM; only the protected backend service role can access rows.
-- One row per slot, keyed wearer pseudonym and UTC minute. Server purges
-- buckets older than seven days on boot and every hour while running.
create table if not exists public.steve_hr_archive (
 slot text not null check (slot ~ '^R(0[1-9]|1[0-5])$'),
 owner text not null check (owner ~ '^[0-9a-f]{64}$'),
 minute_ms bigint not null check (minute_ms > 0 and mod(minute_ms,60000)=0),
 envelope text not null check (octet_length(envelope) between 50 and 12000),
 updated_at timestamptz not null default now(),
 primary key (slot, owner, minute_ms)
);
create index if not exists steve_hr_archive_expiry_idx
 on public.steve_hr_archive (minute_ms);
alter table public.steve_hr_archive enable row level security;
revoke all on table public.steve_hr_archive from public, anon, authenticated;
grant select, insert, update, delete on table public.steve_hr_archive to service_role;
comment on table public.steve_hr_archive is
 'STEVE: server-encrypted BPM minute buckets, pseudonymous owner, seven-day rolling retention; no browser role grants';
