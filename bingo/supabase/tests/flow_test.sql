\set ON_ERROR_STOP on
set search_path = bingo, public;

insert into bingo.rooms (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Sala de pruebas')
  on conflict do nothing;

select set_config('test.player', '22222222-2222-2222-2222-222222222222', false);
select round_id as rid, card as mycard from bingo.join_room('11111111-1111-1111-1111-111111111111') \gset

-- 1. recién creada: nada cantado
select case when (bingo.get_round_state(:'rid')->>'status') = 'pending'
             and jsonb_array_length(bingo.get_round_state(:'rid')->'drawn') = 0
        then '√ ronda pendiente sin bolas' else '× revela bolas antes de tiempo' end;

-- 2. cantar antes de arrancar
select case when (bingo.claim(:'rid','line')->>'reason') = 'not_running'
        then '√ rechaza cantar antes de arrancar' else '× acepta canto fuera de juego' end;

-- 3. viajamos en el tiempo: 10 bolas
update bingo.rounds set started_at = now() - interval '30 seconds' where id = :'rid';
select case when (bingo.get_round_state(:'rid')->>'ballCount')::int = 11
        then '√ revela exactamente las bolas del reloj'
        else format('× esperaba 11, dio %s', bingo.get_round_state(:'rid')->>'ballCount') end;

-- 4. lo que de verdad importa: la secuencia no sale por get_round_state
select case when jsonb_array_length(bingo.get_round_state(:'rid')->'drawn') = 11
        then '√ solo entrega el prefijo cantado, no las 90'
        else '× fuga de bolas futuras' end;

-- 5. cantar bingo con 11 bolas es imposible
select case when (bingo.claim(:'rid','bingo')->>'reason') = 'not_satisfied'
        then '√ rechaza bingo prematuro' else '× acepta bingo falso' end;

-- 6. avanzamos a las 90: el cartón cumple bingo sí o sí
update bingo.rounds set started_at = now() - interval '300 seconds' where id = :'rid';
select case when (bingo.claim(:'rid','line')->>'ok')::bool
        then '√ acepta la línea cuando el cartón la cumple' else '× rechaza línea válida' end;

-- 7. no se canta dos veces
select case when (bingo.claim(:'rid','line')->>'reason') = 'already_claimed'
        then '√ no deja cantar dos veces el mismo premio' else '× permite doble canto' end;
