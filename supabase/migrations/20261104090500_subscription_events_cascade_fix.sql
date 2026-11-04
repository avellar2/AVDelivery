-- Etapa 6A: preserva a limpeza em cascata de lojas sem abrir brecha para
-- exclusão direta de eventos de assinatura.
--
-- O teste de integridade referencial existente exclui uma loja de teste e
-- espera que os vínculos (incluindo o histórico comercial) sejam removidos
-- junto. O gatilho anterior bloqueava essa exclusão em cascata.
--
-- A regra continua imutável em operação normal: UPDATE sempre é recusado e
-- DELETE só é permitido quando a loja proprietária do evento já não existe
-- na mesma transação (isto é, quando a origem foi um cascade de exclusão da
-- loja). Exclusões diretas de eventos continuam bloqueadas.

create or replace function private.subscription_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and not exists (
       select 1
       from public.stores s
       where s.id = old.store_id
     )
  then
    return old;
  end if;

  raise exception 'Eventos de assinatura são imutáveis'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function private.subscription_events_immutable()
  from public, anon, authenticated, service_role;
