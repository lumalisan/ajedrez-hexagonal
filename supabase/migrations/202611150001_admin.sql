begin;

create table hexfortia.site_sessions (
  id uuid primary key,
  visitor_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now()
);
create index site_sessions_started_at on hexfortia.site_sessions (started_at);
create index site_sessions_user_started_at on hexfortia.site_sessions (user_id, started_at);
alter table hexfortia.site_sessions enable row level security;
revoke all on hexfortia.site_sessions from public, anon, authenticated;
grant select, insert, update on hexfortia.site_sessions to hexfortia_server;
create policy server_site_sessions on hexfortia.site_sessions to hexfortia_server
  using (true) with check (true);

-- Project only the account fields needed by the private dashboard.
create function hexfortia.admin_users()
returns table (id uuid, registered_at timestamptz, name text, email text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.created_at, coalesce(n.name, 'Jugador'), coalesce(u.email, '')
  from auth.users u left join hexfortia.usernames n on n.user_id = u.id
  where not coalesce(u.is_anonymous, false);
$$;
revoke all on function hexfortia.admin_users() from public, anon, authenticated;
grant execute on function hexfortia.admin_users() to hexfortia_server;

-- Existing progression can count completed matches even when their replays have rolled out.
create function hexfortia.completed_offline_match_ids(progress text)
returns setof text language plpgsql immutable set search_path = '' as $$
declare matches jsonb;
begin
  matches := (progress::jsonb)->'matches';
  if jsonb_typeof(matches) is distinct from 'object' then return; end if;
  return query select key from jsonb_each(matches)
    where value->>'mode' in ('local', 'machine')
      and jsonb_typeof(value->'completedAt') = 'string'
      and value->>'completedAt' <> '';
exception when invalid_text_representation or untranslatable_character then
  return;
end $$;
revoke all on function hexfortia.completed_offline_match_ids(text) from public, anon, authenticated;
grant execute on function hexfortia.completed_offline_match_ids(text) to hexfortia_server;

-- Keep synchronized history beyond the rolling list stored on each device.
create table hexfortia.account_match_archive (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  completed_at timestamptz not null,
  data jsonb not null,
  primary key (user_id, id)
);
create index account_match_archive_completed on hexfortia.account_match_archive (completed_at desc);
alter table hexfortia.account_match_archive enable row level security;
revoke all on hexfortia.account_match_archive from public, anon, authenticated;
grant select on hexfortia.account_match_archive to hexfortia_server;
create policy server_account_match_archive on hexfortia.account_match_archive
  for select to hexfortia_server using (true);

create function hexfortia.archive_account_history(owner_id uuid, history text)
returns void language plpgsql security definer set search_path = '' as $$
declare item jsonb; completed timestamptz;
begin
  if history is null or jsonb_typeof(history::jsonb) <> 'array' then return; end if;
  for item in select value from jsonb_array_elements(history::jsonb) limit 30 loop
    if jsonb_typeof(item->'id') is distinct from 'string'
      or length(item->>'id') not between 1 and 100
      or jsonb_typeof(item->'definitionId') is distinct from 'string'
      or item->>'definitionId' like 'online:%'
      or coalesce(item #>> '{record,config,definitionId}', '') like 'online:%'
      or jsonb_typeof(item->'participants') is distinct from 'array'
      or coalesce(item #>> '{outcome,type}', '') not in ('win', 'draw')
      or coalesce(item->>'completedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    then continue; end if;
    begin
      completed := (item->>'completedAt')::timestamptz;
    exception when datetime_field_overflow or invalid_datetime_format then
      continue;
    end;
    insert into hexfortia.account_match_archive (user_id, id, completed_at, data)
      values (owner_id, item->>'id', completed, item)
    on conflict (user_id, id) do update set data = excluded.data
      where jsonb_typeof(account_match_archive.data->'record') is distinct from 'object'
        and jsonb_typeof(excluded.data->'record') = 'object';
  end loop;
exception when invalid_text_representation or untranslatable_character then
  -- Legacy or malformed history must never block the rest of a cloud save.
  return;
end $$;

create function hexfortia.archive_account_save()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.data->>'atlas-match-history-v1' is not distinct from old.data->>'atlas-match-history-v1'
    then return new; end if;
  end if;
  perform hexfortia.archive_account_history(new.user_id, new.data->>'atlas-match-history-v1');
  return new;
end $$;
create trigger archive_account_save after insert or update of data on hexfortia.accounts
  for each row execute function hexfortia.archive_account_save();

select hexfortia.archive_account_history(user_id, data->>'atlas-match-history-v1')
from hexfortia.accounts where data ? 'atlas-match-history-v1';

revoke all on function hexfortia.archive_account_history(uuid, text),
  hexfortia.archive_account_save() from public, anon, authenticated;
commit;
