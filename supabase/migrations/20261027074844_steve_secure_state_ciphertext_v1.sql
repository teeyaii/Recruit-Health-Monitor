-- Existing production migration, recorded here for reproducible provisioning.
-- No plaintext recruit data and no browser access policies.
create table if not exists public.steve_secure_state (
 id text primary key check (id = 'primary'),
 envelope text not null check (octet_length(envelope) between 50 and 16000000),
 updated_at timestamptz not null default now()
);
alter table public.steve_secure_state enable row level security;
revoke all on table public.steve_secure_state from public, anon, authenticated;
grant select, insert, update on table public.steve_secure_state to service_role;
comment on table public.steve_secure_state is 'STEVE 1.0: encrypted snapshot only; server-side service role access; no plaintext health data';
