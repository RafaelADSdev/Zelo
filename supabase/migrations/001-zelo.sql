begin;
create table if not exists public.zelo_products (
 id uuid primary key, name text not null, description text not null default '', price text not null default '',
 links jsonb not null default '[]', active boolean not null default true, revision bigint not null default 1, updated bigint not null
);
create table if not exists public.zelo_product_files (
 id uuid primary key, product_id uuid not null references public.zelo_products(id), name text not null,
 mime text not null, size bigint not null check(size > 0 and size <= 52428800), storage_path text not null unique, created bigint not null
);
create table if not exists public.zelo_runtime_snapshots (
 id text primary key, version integer not null, ciphertext text not null, iv text not null, tag text not null,
 sha256 text not null, updated bigint not null
);
alter table public.zelo_products enable row level security;
alter table public.zelo_product_files enable row level security;
alter table public.zelo_runtime_snapshots enable row level security;
revoke all on public.zelo_products,public.zelo_product_files,public.zelo_runtime_snapshots from anon,authenticated;
grant all on public.zelo_products,public.zelo_product_files,public.zelo_runtime_snapshots to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('zelo-materials','zelo-materials',false,52428800,array['image/jpeg','image/png','image/webp','application/pdf'])
 on conflict(id) do nothing;

create or replace function public.zelo_save_product(payload jsonb, target_id uuid)
returns void language plpgsql security invoker set search_path = public,pg_temp as $$
declare previous public.zelo_products;
begin
 perform pg_advisory_xact_lock(81127001);
 select * into previous from public.zelo_products where id=target_id for update;
 if found then
  if previous.revision <> (payload->>'revision')::bigint then raise exception 'A ficha mudou. Reabra o produto antes de salvar.'; end if;
  update public.zelo_products set name=payload->>'name',description=payload->>'description',price=payload->>'price',links=payload->'links',active=(payload->>'active')::boolean,revision=revision+1,updated=(payload->>'updated')::bigint where id=target_id;
 else
  if (select count(*) from public.zelo_products)>=100 then raise exception 'O catálogo aceita até 100 produtos.'; end if;
  insert into public.zelo_products values(target_id,payload->>'name',payload->>'description',payload->>'price',payload->'links',(payload->>'active')::boolean,1,(payload->>'updated')::bigint);
 end if;
end $$;
create or replace function public.zelo_register_file(payload jsonb)
returns void language plpgsql security invoker set search_path = public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(81127002);
 if (select count(*) from public.zelo_product_files where product_id=(payload->>'product_id')::uuid)>=100 then raise exception 'Cada produto aceita até 100 arquivos.'; end if;
 if (select coalesce(sum(size),0) from public.zelo_product_files)+(payload->>'size')::bigint>524288000 then raise exception 'O catálogo atingiu o limite de 500 MB.'; end if;
 insert into public.zelo_product_files values((payload->>'id')::uuid,(payload->>'product_id')::uuid,payload->>'name',payload->>'mime',(payload->>'size')::bigint,payload->>'storage_path',(payload->>'created')::bigint);
 update public.zelo_products set revision=revision+1,updated=(payload->>'created')::bigint where id=(payload->>'product_id')::uuid;
end $$;
create or replace function public.zelo_remove_file(target_product uuid,target_file uuid,expected_revision bigint)
returns text language plpgsql security invoker set search_path = public,pg_temp as $$
declare actual_revision bigint; object_path text;
begin
 select revision into actual_revision from public.zelo_products where id=target_product for update;
 if actual_revision is distinct from expected_revision then raise exception 'A ficha mudou. Reabra o produto antes de remover o anexo.'; end if;
 delete from public.zelo_product_files where id=target_file and product_id=target_product returning storage_path into object_path;
 if object_path is not null then update public.zelo_products set revision=revision+1,updated=(extract(epoch from clock_timestamp())*1000)::bigint where id=target_product; end if;
 return object_path;
end $$;
revoke all on function public.zelo_save_product(jsonb,uuid),public.zelo_register_file(jsonb),public.zelo_remove_file(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.zelo_save_product(jsonb,uuid),public.zelo_register_file(jsonb),public.zelo_remove_file(uuid,uuid,bigint) to service_role;
commit;
