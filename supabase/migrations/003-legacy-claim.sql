begin;
-- service_role has Auth Admin API access, but no direct SELECT on auth.users.
-- The backend verifies the legacy identity through Auth Admin before this call.
-- Keep SECURITY INVOKER and the existing service_role-only execution grant.
create or replace function public.zelo_claim_legacy(target_owner uuid,target_email text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(81127003);
 if exists(select 1 from public.zelo_workspaces where role='owner' and user_id<>target_owner) then raise exception 'Administrador já definido.'; end if;
 insert into public.zelo_workspaces(email,user_id,role,created) values(lower(target_email),target_owner,'owner',(extract(epoch from now())*1000)::bigint) on conflict(email) do nothing;
 if not exists(select 1 from public.zelo_workspaces where email=lower(target_email) and user_id=target_owner and role='owner') then raise exception 'Vínculo do administrador inválido.'; end if;
 update public.zelo_products set owner_id=target_owner where owner_id is null;
 update public.zelo_product_files f set owner_id=p.owner_id from public.zelo_products p where f.product_id=p.id and f.owner_id is null;
end $$;
revoke all on function public.zelo_claim_legacy(uuid,text) from public,anon,authenticated;
grant execute on function public.zelo_claim_legacy(uuid,text) to service_role;
commit;
