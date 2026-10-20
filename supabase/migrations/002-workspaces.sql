begin;
-- Membership is managed only by the backend. Supabase sign-up alone grants no access.
create table if not exists public.zelo_workspaces (
 email text primary key check(email=lower(email)), user_id uuid unique references auth.users(id),
 role text not null default 'member' check(role in ('owner','member')),
 enabled boolean not null default true, invitation_hash text, invitation_expires bigint,
 created bigint not null, constraint invitation_digest check(invitation_hash is null or invitation_hash ~ '^[a-f0-9]{64}$')
);
create unique index if not exists zelo_one_owner on public.zelo_workspaces(role) where role='owner';
alter table public.zelo_workspaces enable row level security;
revoke all on public.zelo_workspaces from public,anon,authenticated;
grant all on public.zelo_workspaces to service_role;
alter table public.zelo_products add column if not exists owner_id uuid references auth.users(id);
alter table public.zelo_product_files add column if not exists owner_id uuid references auth.users(id);
create index if not exists zelo_products_owner on public.zelo_products(owner_id,updated desc);
create index if not exists zelo_files_owner on public.zelo_product_files(owner_id,product_id);

create or replace function public.zelo_claim_legacy(target_owner uuid,target_email text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(81127003);
 if exists(select 1 from zelo_workspaces where role='owner' and user_id<>target_owner) then raise exception 'Administrador já definido.'; end if;
 if not exists(select 1 from auth.users where id=target_owner and lower(email)=lower(target_email)) then raise exception 'Conta inválida.'; end if;
 insert into zelo_workspaces(email,user_id,role,created) values(lower(target_email),target_owner,'owner',(extract(epoch from now())*1000)::bigint) on conflict(email) do nothing;
 update zelo_products set owner_id=target_owner where owner_id is null;
 update zelo_product_files f set owner_id=p.owner_id from zelo_products p where f.product_id=p.id and f.owner_id is null;
end $$;

create or replace function public.zelo_workspace_save_product(payload jsonb,target_id uuid,target_owner uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare previous zelo_products;
begin
 perform pg_advisory_xact_lock(hashtextextended(target_owner::text,81127001));
 if not exists(select 1 from zelo_workspaces where user_id=target_owner and enabled) then raise exception 'Ambiente indisponível.'; end if;
 select * into previous from zelo_products where id=target_id for update;
 if found then
  if previous.owner_id is distinct from target_owner then raise exception 'Produto não encontrado.'; end if;
  if previous.revision is distinct from (payload->>'revision')::bigint then raise exception 'A ficha mudou. Reabra o produto.'; end if;
  update zelo_products set name=payload->>'name',description=payload->>'description',price=payload->>'price',links=payload->'links',active=(payload->>'active')::boolean,revision=revision+1,updated=(payload->>'updated')::bigint where id=target_id and owner_id=target_owner;
 else
  if (select count(*) from zelo_products where owner_id=target_owner)>=100 then raise exception 'O catálogo aceita até 100 produtos por conta.'; end if;
  insert into zelo_products(id,name,description,price,links,active,revision,updated,owner_id) values(target_id,payload->>'name',payload->>'description',payload->>'price',payload->'links',(payload->>'active')::boolean,1,(payload->>'updated')::bigint,target_owner);
 end if;
end $$;

create or replace function public.zelo_workspace_register_file(payload jsonb,target_owner uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(target_owner::text,81127002));
 perform 1 from zelo_products where id=(payload->>'product_id')::uuid and owner_id=target_owner for update;
 if not found then raise exception 'Produto não encontrado.'; end if;
 if payload->>'storage_path' <> target_owner::text||'/'||(payload->>'product_id')||'/'||(payload->>'id') then raise exception 'Caminho inválido.'; end if;
 if (select count(*) from zelo_product_files where product_id=(payload->>'product_id')::uuid)>=100 then raise exception 'Cada produto aceita até 100 arquivos.'; end if;
 if (select coalesce(sum(size),0) from zelo_product_files where owner_id=target_owner)+(payload->>'size')::bigint>524288000 then raise exception 'O catálogo desta conta atingiu 500 MB.'; end if;
 insert into zelo_product_files(id,product_id,name,mime,size,storage_path,created,owner_id) values((payload->>'id')::uuid,(payload->>'product_id')::uuid,payload->>'name',payload->>'mime',(payload->>'size')::bigint,payload->>'storage_path',(payload->>'created')::bigint,target_owner);
 update zelo_products set revision=revision+1,updated=(payload->>'created')::bigint where id=(payload->>'product_id')::uuid and owner_id=target_owner;
end $$;

create or replace function public.zelo_workspace_remove_file(target_product uuid,target_file uuid,expected_revision bigint,target_owner uuid)
returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare actual_revision bigint; object_path text;
begin
 select revision into actual_revision from zelo_products where id=target_product and owner_id=target_owner for update;
 if not found then raise exception 'Produto não encontrado.'; end if;
 if actual_revision is distinct from expected_revision then raise exception 'A ficha mudou. Reabra o produto.'; end if;
 delete from zelo_product_files where id=target_file and product_id=target_product and owner_id=target_owner returning storage_path into object_path;
 if object_path is not null then update zelo_products set revision=revision+1,updated=(extract(epoch from clock_timestamp())*1000)::bigint where id=target_product and owner_id=target_owner; end if;
 return object_path;
end $$;
revoke all on function public.zelo_claim_legacy(uuid,text),public.zelo_workspace_save_product(jsonb,uuid,uuid),public.zelo_workspace_register_file(jsonb,uuid),public.zelo_workspace_remove_file(uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.zelo_claim_legacy(uuid,text),public.zelo_workspace_save_product(jsonb,uuid,uuid),public.zelo_workspace_register_file(jsonb,uuid),public.zelo_workspace_remove_file(uuid,uuid,bigint,uuid) to service_role;
commit;
