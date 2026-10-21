-- Run after 202610210001_online.sql, using the SQL editor as an administrator.
-- Passwords and email verification belong to Supabase Auth, never to this table.
create table if not exists hexfortia.accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null check (revision > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
alter table hexfortia.accounts enable row level security;
revoke all on hexfortia.accounts from public, anon, authenticated;
grant select, insert, update, delete on hexfortia.accounts to hexfortia_server;
create policy server_accounts on hexfortia.accounts for all to hexfortia_server
  using (true) with check (true);
