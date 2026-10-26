-- Only the authenticated Node API can invoke this operation; never expose it to browser roles.
create or replace function hexfortia.delete_account(target uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('account:' || target::text, 0));
  if exists (
    select 1 from hexfortia.matches where target = any(player_ids) and not settled
  ) then
    return false;
  end if;
  -- Preserve opponents' results while removing the deleted player's display name.
  update hexfortia.matches
  set data = jsonb_set(data, '{record,config,participants,0,name}', '"Cuenta eliminada"')
  where player_ids[1] = target;
  update hexfortia.matches
  set data = jsonb_set(data, '{record,config,participants,1,name}', '"Cuenta eliminada"')
  where player_ids[2] = target;
  -- Account documents, player, queue and private rooms cascade through their foreign keys.
  delete from auth.users where id = target;
  return true;
end;
$$;
revoke all on function hexfortia.delete_account(uuid) from public, anon, authenticated;
grant execute on function hexfortia.delete_account(uuid) to hexfortia_server;
