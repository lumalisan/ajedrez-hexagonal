-- Run through Supabase migrations or the SQL editor using an administrative role.
-- No browser role can read or modify matchmaking, clocks, results or ratings.
create schema if not exists hexfortia;
revoke all on schema hexfortia from public, anon, authenticated;

create table hexfortia.players (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 40),
  elo integer not null default 1000 check (elo >= 0),
  played integer not null default 0 check (played >= 0)
);
create table hexfortia.queue (
  player_id uuid primary key references hexfortia.players(id) on delete cascade,
  joined_at timestamptz not null,
  data jsonb not null
);
create index queue_oldest on hexfortia.queue(joined_at, player_id);
create table hexfortia.rooms (
  code text primary key check (code ~ '^[0-9]{6}$'),
  creator_id uuid not null unique references hexfortia.players(id) on delete cascade,
  data jsonb not null
);
create table hexfortia.matches (
  id uuid primary key,
  player_ids uuid[] not null check (cardinality(player_ids) = 2 and player_ids[1] <> player_ids[2]),
  created_at timestamptz not null default now(),
  settled boolean not null default false,
  data jsonb not null
);
create index matches_players on hexfortia.matches using gin(player_ids);
create index matches_unsettled on hexfortia.matches(id) where settled = false;

alter table hexfortia.players enable row level security;
alter table hexfortia.queue enable row level security;
alter table hexfortia.rooms enable row level security;
alter table hexfortia.matches enable row level security;
revoke all on all tables in schema hexfortia from public, anon, authenticated;
-- Use a dedicated server login. Supply its password securely outside this migration.
do $$ begin
  if not exists (select from pg_roles where rolname = 'hexfortia_server') then
    create role hexfortia_server login;
  end if;
end $$;
grant usage on schema hexfortia to hexfortia_server;
grant select, insert, update, delete on all tables in schema hexfortia to hexfortia_server;
create policy server_players on hexfortia.players to hexfortia_server using (true) with check (true);
create policy server_queue on hexfortia.queue to hexfortia_server using (true) with check (true);
create policy server_rooms on hexfortia.rooms to hexfortia_server using (true) with check (true);
create policy server_matches on hexfortia.matches to hexfortia_server using (true) with check (true);
