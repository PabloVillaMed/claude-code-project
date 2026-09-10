-- Bingo 90 bolas. La autoridad del juego vive aquí: el cliente solo dibuja.
create schema if not exists bingo;

-- ---------------------------------------------------------------- aleatoriedad
-- Determinista y sin estado de sesión: misma semilla, misma partida.
-- Permite auditar una ronda a posteriori a partir de su seed.
create or replace function bingo.rnd(p_seed text, p_i int)
returns double precision
language sql immutable as $$
  select ('x' || substr(md5(p_seed || ':' || p_i), 1, 8))::bit(32)::bigint::double precision
         / 4294967296.0;
$$;

-- ------------------------------------------------------------------- cartones
-- 9 columnas x 3 filas, 15 números, 5 por fila, 1-3 por columna,
-- cada columna con los números de su decena y ordenada de arriba abajo.
create or replace function bingo.generate_card(p_seed text)
returns smallint[]
language plpgsql immutable as $$
declare
  counts int[] := array[1,1,1,1,1,1,1,1,1];
  left_to_place int := 6;
  step int := 0;
  col int;
  capacity int[] := array[5,5,5];
  mask bool[][];
  card smallint[] := array_fill(0::smallint, array[27]);
  lo int; hi int; pool int[]; picked int[];
  i int; j int; tmp int; k int; row_i int;
  order_cols int[];
  best_row int; best_cap int; taken int;
begin
  -- reparto de cuántos números lleva cada columna
  while left_to_place > 0 loop
    step := step + 1;
    col := 1 + floor(bingo.rnd(p_seed || 'c', step) * 9)::int;
    if counts[col] < 3 then
      counts[col] := counts[col] + 1;
      left_to_place := left_to_place - 1;
    end if;
  end loop;

  -- columnas de mayor a menor: las de 3 ocupan todo y no dejan elección
  select array_agg(c order by counts[c] desc, bingo.rnd(p_seed || 'o', c))
    into order_cols from generate_series(1,9) c;

  mask := array_fill(false, array[9,3]);
  foreach col in array order_cols loop
    taken := 0;
    while taken < counts[col] loop
      best_row := null; best_cap := -1;
      for row_i in 1..3 loop
        if not mask[col][row_i] and capacity[row_i] > best_cap then
          best_cap := capacity[row_i]; best_row := row_i;
        end if;
      end loop;
      mask[col][best_row] := true;
      capacity[best_row] := capacity[best_row] - 1;
      taken := taken + 1;
    end loop;
  end loop;

  -- números de cada columna, barajados por la semilla y ordenados al colocar
  for col in 1..9 loop
    if col = 1 then lo := 1; hi := 9;
    elsif col = 9 then lo := 80; hi := 90;
    else lo := (col - 1) * 10; hi := lo + 9;
    end if;

    select array_agg(n order by n) into pool from generate_series(lo, hi) n;
    for i in 1..counts[col] loop
      j := i + floor(bingo.rnd(p_seed || 'p' || col, i) * (array_length(pool,1) - i + 1))::int;
      tmp := pool[i]; pool[i] := pool[j]; pool[j] := tmp;
    end loop;
    select array_agg(v order by v) into picked
      from unnest(pool[1:counts[col]]) v;

    k := 1;
    for row_i in 1..3 loop
      if mask[col][row_i] then
        card[(row_i - 1) * 9 + col] := picked[k]::smallint;
        k := k + 1;
      end if;
    end loop;
  end loop;

  return card;
end;
$$;

-- --------------------------------------------------------------------- tablas
create table if not exists bingo.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ball_interval_ms int not null default 3000,
  created_at timestamptz not null default now()
);

create table if not exists bingo.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references bingo.rooms(id) on delete cascade,
  started_at timestamptz not null,
  ball_interval_ms int not null default 3000,
  line_by uuid, line_ball int,
  double_line_by uuid, double_line_ball int,
  bingo_by uuid, bingo_ball int,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- La secuencia vive aparte porque RLS filtra filas, no columnas.
create table if not exists bingo.round_secrets (
  round_id uuid primary key references bingo.rounds(id) on delete cascade,
  sequence smallint[] not null,
  seed text not null
);

create table if not exists bingo.cards (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references bingo.rounds(id) on delete cascade,
  player_id uuid not null,
  numbers smallint[] not null,
  unique (round_id, player_id)
);

create table if not exists bingo.claims (
  id bigserial primary key,
  round_id uuid not null references bingo.rounds(id) on delete cascade,
  player_id uuid not null,
  kind text not null check (kind in ('line','double_line','bingo')),
  ball_index int not null,
  accepted bool not null,
  created_at timestamptz not null default now()
);

alter table bingo.rooms          enable row level security;
alter table bingo.rounds         enable row level security;
alter table bingo.round_secrets  enable row level security;
alter table bingo.cards          enable row level security;
alter table bingo.claims         enable row level security;

-- round_secrets se queda SIN políticas: nadie lo lee salvo las funciones.
drop policy if exists rooms_read on bingo.rooms;
create policy rooms_read on bingo.rooms for select using (true);
drop policy if exists rounds_read on bingo.rounds;
create policy rounds_read on bingo.rounds for select using (true);
drop policy if exists cards_own on bingo.cards;
create policy cards_own on bingo.cards for select using (player_id = auth.uid());
drop policy if exists claims_read on bingo.claims;
create policy claims_read on bingo.claims for select using (true);

-- ------------------------------------------------------------------- el reloj
create or replace function bingo.balls_drawn(p_started timestamptz, p_interval int)
returns int
language sql stable as $$
  select greatest(0, least(90,
    case when now() < p_started then 0
         else floor(extract(epoch from (now() - p_started)) * 1000 / p_interval)::int + 1
    end));
$$;

-- ------------------------------------------------------------------ los cantos
create or replace function bingo.completed_rows(p_card smallint[], p_drawn smallint[])
returns int
language sql immutable as $$
  select count(*)::int from generate_series(0,2) r
  where (select count(*) from unnest(p_card[r*9+1 : r*9+9]) n where n <> 0) = 5
    and not exists (
      select 1 from unnest(p_card[r*9+1 : r*9+9]) n
      where n <> 0 and not (n = any(p_drawn))
    );
$$;

create or replace function bingo.satisfies(p_card smallint[], p_drawn smallint[], p_kind text)
returns bool
language sql immutable as $$
  select case p_kind
    when 'line'        then bingo.completed_rows(p_card, p_drawn) >= 1
    when 'double_line' then bingo.completed_rows(p_card, p_drawn) >= 2
    when 'bingo'       then bingo.completed_rows(p_card, p_drawn) = 3
    else false end;
$$;

-- ----------------------------------------------------------------------- RPCs
create or replace function bingo.join_room(p_room uuid)
returns table (round_id uuid, card smallint[])
language plpgsql security definer set search_path = bingo, public as $$
declare
  v_round bingo.rounds;
  v_seq smallint[];
  v_seed text;
  v_card smallint[];
  v_player uuid := auth.uid();
begin
  if v_player is null then raise exception 'sin sesión'; end if;

  select * into v_round from bingo.rounds
   where room_id = p_room and finished_at is null
   order by created_at desc limit 1;

  if not found then
    v_seed := gen_random_uuid()::text;
    insert into bingo.rounds (room_id, started_at, ball_interval_ms)
      select p_room, now() + interval '5 seconds', ball_interval_ms
        from bingo.rooms where id = p_room
      returning * into v_round;

    select array_agg(n::smallint order by bingo.rnd(v_seed || 's', n))
      into v_seq from generate_series(1,90) n;
    insert into bingo.round_secrets (round_id, sequence, seed)
      values (v_round.id, v_seq, v_seed);
  end if;

  -- alias obligatorio: el OUT param round_id choca con la columna homónima
  select ca.numbers into v_card from bingo.cards ca
   where ca.round_id = v_round.id and ca.player_id = v_player;

  if v_card is null then
    v_card := bingo.generate_card(v_round.id::text || ':' || v_player::text);
    insert into bingo.cards (round_id, player_id, numbers)
      values (v_round.id, v_player, v_card);
  end if;

  return query select v_round.id, v_card;
end;
$$;

create or replace function bingo.get_round_state(p_round uuid)
returns jsonb
language plpgsql security definer set search_path = bingo, public as $$
declare
  v_round bingo.rounds;
  v_count int;
  v_seq smallint[];
begin
  select * into v_round from bingo.rounds where id = p_round;
  if not found then raise exception 'ronda desconocida'; end if;

  v_count := bingo.balls_drawn(v_round.started_at, v_round.ball_interval_ms);
  select sequence into v_seq from bingo.round_secrets where round_id = p_round;

  if v_count >= 90 and v_round.finished_at is null then
    update bingo.rounds set finished_at = now() where id = p_round
      returning * into v_round;
  end if;

  return jsonb_build_object(
    'roundId', v_round.id,
    'status', case when v_round.finished_at is not null then 'finished'
                   when v_count = 0 then 'pending' else 'running' end,
    -- solo el prefijo que el reloj autoriza: lo demás no sale de aquí
    'drawn', to_jsonb(coalesce(v_seq[1:v_count], '{}'::smallint[])),
    'ballCount', v_count,
    'claims', jsonb_build_object(
      'line', case when v_round.line_by is null then null else
        jsonb_build_object('playerId', v_round.line_by, 'ballIndex', v_round.line_ball) end,
      'double_line', case when v_round.double_line_by is null then null else
        jsonb_build_object('playerId', v_round.double_line_by, 'ballIndex', v_round.double_line_ball) end,
      'bingo', case when v_round.bingo_by is null then null else
        jsonb_build_object('playerId', v_round.bingo_by, 'ballIndex', v_round.bingo_ball) end
    )
  );
end;
$$;

create or replace function bingo.claim(p_round uuid, p_kind text)
returns jsonb
language plpgsql security definer set search_path = bingo, public as $$
declare
  v_round bingo.rounds;
  v_count int;
  v_seq smallint[];
  v_card smallint[];
  v_player uuid := auth.uid();
  v_taken uuid;
begin
  if v_player is null then raise exception 'sin sesión'; end if;
  if p_kind not in ('line','double_line','bingo') then raise exception 'canto inválido'; end if;

  -- serializa los cantos simultáneos: gana quien llega primero
  select * into v_round from bingo.rounds where id = p_round for update;
  if not found then raise exception 'ronda desconocida'; end if;

  v_count := bingo.balls_drawn(v_round.started_at, v_round.ball_interval_ms);
  if v_count = 0 or v_round.finished_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_running');
  end if;

  v_taken := case p_kind when 'line' then v_round.line_by
                         when 'double_line' then v_round.double_line_by
                         else v_round.bingo_by end;
  if v_taken is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_claimed');
  end if;

  select numbers into v_card from bingo.cards
   where round_id = p_round and player_id = v_player;
  if v_card is null then
    return jsonb_build_object('ok', false, 'reason', 'no_card');
  end if;

  select sequence into v_seq from bingo.round_secrets where round_id = p_round;

  if not bingo.satisfies(v_card, v_seq[1:v_count], p_kind) then
    insert into bingo.claims (round_id, player_id, kind, ball_index, accepted)
      values (p_round, v_player, p_kind, v_count, false);
    return jsonb_build_object('ok', false, 'reason', 'not_satisfied');
  end if;

  update bingo.rounds set
    line_by         = case when p_kind = 'line' then v_player else line_by end,
    line_ball       = case when p_kind = 'line' then v_count else line_ball end,
    double_line_by  = case when p_kind = 'double_line' then v_player else double_line_by end,
    double_line_ball= case when p_kind = 'double_line' then v_count else double_line_ball end,
    bingo_by        = case when p_kind = 'bingo' then v_player else bingo_by end,
    bingo_ball      = case when p_kind = 'bingo' then v_count else bingo_ball end,
    finished_at     = case when p_kind = 'bingo' then now() else finished_at end
  where id = p_round;

  insert into bingo.claims (round_id, player_id, kind, ball_index, accepted)
    values (p_round, v_player, p_kind, v_count, true);

  return jsonb_build_object('ok', true, 'kind', p_kind, 'ballIndex', v_count);
end;
$$;
