-- Apply after the accounts migration, as an administrator. Names belong to Auth users.
begin;

create table hexfortia.usernames (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24 and name = btrim(name)),
  unique (name)
);
create unique index usernames_case_insensitive on hexfortia.usernames (lower(name));
alter table hexfortia.usernames enable row level security;
revoke all on hexfortia.usernames from public, anon, authenticated;

-- Preserve existing names where possible. Resolve pre-existing collisions deterministically.
do $$
declare item record; candidate text; suffix integer;
begin
  for item in
    select u.id, coalesce(nullif(btrim(a.data->>'hexagonal:user-profile:v1'), ''), '{}')::jsonb as profile
    from auth.users u left join hexfortia.accounts a on a.user_id = u.id
    where not coalesce(u.is_anonymous, false) order by u.created_at, u.id
  loop
    candidate := left(btrim(normalize(coalesce(item.profile->>'name', ''), NFKC)), 24);
    if candidate = '' then candidate := left('user' || replace(item.id::text, '-', ''), 24); end if;
    suffix := 0;
    loop
      begin
        insert into hexfortia.usernames values (item.id, candidate);
        exit;
      exception when unique_violation then
        suffix := suffix + 1;
        candidate := left(candidate, 12) || '_' || left(replace(item.id::text, '-', ''), 6) || '_' || suffix;
      end;
    end loop;
    update hexfortia.accounts set data = jsonb_set(data, '{hexagonal:user-profile:v1}',
      to_jsonb(((case when jsonb_typeof(item.profile) = 'object' then item.profile else '{}'::jsonb end) || jsonb_build_object('name', candidate))::text)) where user_id = item.id;
    insert into hexfortia.accounts (user_id, revision, data) values (item.id, 1,
      jsonb_build_object('hexagonal:user-profile:v1', jsonb_build_object('name', candidate, 'emblem', 'fortress', 'color', 'cyan')::text))
      on conflict (user_id) do nothing;
    update hexfortia.players set name = candidate where id = item.id;
  end loop;
end $$;

create function hexfortia.valid_username(requested_name text) returns text
language plpgsql immutable set search_path = '' as $$
declare cleaned text := btrim(normalize(requested_name, NFKC));
begin
  if cleaned is null or char_length(cleaned) not between 1 and 24 or cleaned ~ '[[:cntrl:]]' then
    raise exception 'Nombre de usuario no válido.';
  end if;
  return cleaned;
end $$;

create function public.username_available(requested_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from hexfortia.usernames
    where lower(name) = lower(hexfortia.valid_username(requested_name))
    and user_id is distinct from auth.uid());
$$;

create function public.claim_username(requested_name text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare cleaned text := hexfortia.valid_username(requested_name); owner_id uuid := auth.uid();
begin
  if owner_id is null or not exists (select 1 from auth.users where id = owner_id and not coalesce(is_anonymous, false)) then
    raise exception 'Inicia sesión para reservar un nombre.';
  end if;
  insert into hexfortia.usernames values (owner_id, cleaned)
    on conflict (user_id) do update set name = excluded.name;
  update hexfortia.accounts set data = jsonb_set(data, '{hexagonal:user-profile:v1}',
    to_jsonb((coalesce((data->>'hexagonal:user-profile:v1')::jsonb, '{}'::jsonb) || jsonb_build_object('name', cleaned))::text))
    where user_id = owner_id;
  update hexfortia.players set name = cleaned where id = owner_id;
  return true;
exception when unique_violation then return false;
end $$;

create function hexfortia.register_username() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cleaned text;
begin
  if coalesce(new.is_anonymous, false) then return new; end if;
  cleaned := hexfortia.valid_username(new.raw_user_meta_data->>'username');
  insert into hexfortia.usernames values (new.id, cleaned);
  insert into hexfortia.accounts (user_id, revision, data) values (new.id, 1,
    jsonb_build_object('hexagonal:user-profile:v1', jsonb_build_object('name', cleaned, 'emblem', 'fortress', 'color', 'cyan')::text));
  return new;
end $$;
create trigger register_username after insert on auth.users
  for each row execute function hexfortia.register_username();

-- Old devices, guest imports and direct API saves cannot replace a reserved identity.
create function hexfortia.enforce_username() returns trigger
language plpgsql security definer set search_path = '' as $$
declare reserved text; profile jsonb;
begin
  select name into reserved from hexfortia.usernames where user_id = new.user_id;
  if reserved is not null then
    profile := (new.data->>'hexagonal:user-profile:v1')::jsonb;
    if jsonb_typeof(profile) is distinct from 'object' then profile := '{}'::jsonb; end if;
    new.data := jsonb_set(new.data, '{hexagonal:user-profile:v1}',
      to_jsonb((profile || jsonb_build_object('name', reserved))::text));
  end if;
  return new;
end $$;
create trigger enforce_username before insert or update on hexfortia.accounts
  for each row execute function hexfortia.enforce_username();

revoke all on function hexfortia.valid_username(text), hexfortia.register_username(), hexfortia.enforce_username() from public;
revoke all on function public.username_available(text), public.claim_username(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.claim_username(text) to authenticated;
commit;
