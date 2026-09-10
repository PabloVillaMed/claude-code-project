\set ON_ERROR_STOP on
-- 300 cartones generados por SQL deben cumplir lo mismo que los de TypeScript.
with cards as (
  select s::text as seed, bingo.generate_card(s::text) as c
  from generate_series(1, 300) s
),
checks as (
  select seed, c,
    (select count(*) from unnest(c) n where n <> 0) as nums,
    array_length(c, 1) as cells,
    (select bool_and(cnt = 5) from (
        select count(*) filter (where n <> 0) as cnt
        from (select generate_series(0,2) r) rr,
             lateral unnest(c[rr.r*9+1 : rr.r*9+9]) n
        group by rr.r) x) as rows_ok,
    (select bool_and(cnt between 1 and 3) from (
        select count(*) filter (where c[(r)*9 + col] <> 0) as cnt
        from generate_series(1,9) col, generate_series(0,2) r
        group by col) y) as cols_ok,
    (select bool_and(
        case when col = 1 then n between 1 and 9
             when col = 9 then n between 80 and 90
             else n between (col-1)*10 and (col-1)*10 + 9 end)
      from generate_series(1,9) col, generate_series(0,2) r,
           lateral (select c[r*9+col] as n) v
      where n <> 0) as range_ok,
    (select count(distinct n) = count(*) from unnest(c) n where n <> 0) as unique_ok
  from cards
)
select
  count(*) filter (where cells <> 27)      as mal_celdas,
  count(*) filter (where nums <> 15)       as mal_numeros,
  count(*) filter (where not rows_ok)      as mal_filas,
  count(*) filter (where not cols_ok)      as mal_columnas,
  count(*) filter (where not range_ok)     as mal_rango,
  count(*) filter (where not unique_ok)    as mal_repetidos
from checks \gset

select case when :mal_celdas + :mal_numeros + :mal_filas + :mal_columnas
              + :mal_rango + :mal_repetidos = 0
       then '√ 300 cartones SQL cumplen todas las invariantes'
       else format('× fallos: celdas=%s numeros=%s filas=%s columnas=%s rango=%s repes=%s',
            :mal_celdas, :mal_numeros, :mal_filas, :mal_columnas, :mal_rango, :mal_repetidos)
       end as resultado;

-- determinismo
select case when bingo.generate_card('x') = bingo.generate_card('x')
             and bingo.generate_card('x') <> bingo.generate_card('y')
       then '√ determinista' else '× no determinista' end as resultado;
