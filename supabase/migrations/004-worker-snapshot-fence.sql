begin;

create or replace function public.zelo_publish_worker_snapshot(lease_digest text, payload jsonb)
returns boolean language plpgsql security invoker set search_path = public,pg_temp as $$
declare
  lease_updated bigint;
  saved public.zelo_runtime_snapshots;
begin
  select updated into lease_updated from public.zelo_runtime_snapshots
   where id = 'worker-lease' and sha256 = lease_digest for share;
  if not found or (extract(epoch from clock_timestamp())*1000)::bigint - lease_updated >= 45000 then
    return false;
  end if;
  if payload is null or payload = 'null'::jsonb then
    return true;
  end if;
  saved := jsonb_populate_record(null::public.zelo_runtime_snapshots, payload);
  if saved.id is null or (saved.id <> 'gateway' and saved.id !~ '^workspace:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then
    raise exception 'Registro inválido para o worker.';
  end if;
  insert into public.zelo_runtime_snapshots(id, version, ciphertext, iv, tag, sha256, updated)
  values(saved.id, saved.version, saved.ciphertext, saved.iv, saved.tag, saved.sha256, saved.updated)
  on conflict (id) do update set version = excluded.version, ciphertext = excluded.ciphertext,
    iv = excluded.iv, tag = excluded.tag, sha256 = excluded.sha256, updated = excluded.updated;
  return true;
end $$;

revoke all on function public.zelo_publish_worker_snapshot(text,jsonb) from public,anon,authenticated;
grant execute on function public.zelo_publish_worker_snapshot(text,jsonb) to service_role;

commit;
