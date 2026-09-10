\set ON_ERROR_STOP on
-- Rol equivalente al 'authenticated' de Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'jugador') then
    create role jugador nologin;
  end if;
end $$;
grant usage on schema bingo to jugador;
grant select on bingo.rooms, bingo.rounds, bingo.cards, bingo.claims to jugador;
grant select on bingo.round_secrets to jugador;   -- incluso concediéndolo a propósito
grant execute on all functions in schema bingo to jugador;

set role jugador;
select case when (select count(*) from bingo.round_secrets) = 0
        then '√ round_secrets ilegible incluso con GRANT SELECT explícito'
        else format('× FUGA: %s filas visibles', (select count(*) from bingo.round_secrets)) end;
reset role;

select case when (select count(*) from bingo.round_secrets) > 0
        then '√ los datos sí están ahí (la prueba anterior no es un falso positivo)'
        else '× la tabla está vacía, la prueba no valía' end;
