# Bingo 90 en línea — motor de juego (MVP 1)

## Decisiones de producto

| | |
|---|---|
| Economía | Puntos canjeables por actividad, nunca por el resultado del sorteo |
| Variante | 90 bolas: cartón 9x3, línea / dos líneas / bingo |
| Mercado | LatAm, español |
| Stack | Expo + React Native |
| Backend | Supabase (Postgres + RLS) |

**Por qué los puntos van por actividad y no por ganar.** El test habitual de si
algo es juego de azar regulado tiene tres patas: pago, azar y premio. Ligar los
puntos a rachas y misiones en vez de al sorteo elimina la pata del azar, así que
no hace falta licencia, KYC ni verificación de edad. También es lo más barato de
construir: un saldo y un registro de movimientos.

## Alcance

Bingo en línea son cuatro subsistemas: motor de juego, cuentas, economía y
catálogo de canje. Este spec cubre **solo el motor**, que es lo único que hay que
validar de verdad: si el sorteo sincronizado no se siente bien, lo demás sobra.

## Sincronización del sorteo

Se evaluaron tres opciones:

- **A. RPC autoritativa + lectura temporizada** — elegida.
- **B. Worker persistente + Realtime** — escala mejor, pero añade un servicio que
  operar. Es a donde migrar cuando el sondeo duela, no por donde empezar.
- **C. Secuencia enviada al cliente** — descartada: cualquiera que abra el bundle
  ve el orden de las 90 bolas.

En A el servidor genera la secuencia al crear la ronda y la guarda sin enviarla
nunca. `get_round_state` calcula en servidor cuántas bolas ha autorizado el reloj
y devuelve solo ese prefijo. Los cantos se validan contra la secuencia guardada.

**El ciclo de vida no necesita planificador.** Las transiciones ocurren de forma
perezosa dentro de las RPC que el cliente ya llama:

```
pending ──[join_room fija started_at]──> running
running ──[get_round_state ve n ≥ 90, o claim de bingo]──> finished
```

Ni cron, ni worker, ni Edge Function con timeout. El reloj de Postgres arbitra.

## Modelo de datos

```
rooms          id, name, ball_interval_ms
rounds         id, room_id, started_at, ball_interval_ms,
               line_by/ball, double_line_by/ball, bingo_by/ball, finished_at
round_secrets  round_id, sequence smallint[90], seed   ← RLS sin políticas
cards          id, round_id, player_id, numbers smallint[27]
claims         id, round_id, player_id, kind, ball_index, accepted
```

`round_secrets` vive aparte porque **RLS filtra filas, no columnas**: si la
secuencia estuviera en `rounds`, un `select *` la expondría. Con RLS activado y
cero políticas, la tabla es ilegible salvo desde funciones `SECURITY DEFINER`.
Verificado con una prueba que concede `GRANT SELECT` a propósito y aun así no lee
nada.

## Reglas del juego

Un cartón válido de 90 bolas: 9 columnas x 3 filas, 15 números, exactamente 5 por
fila, entre 1 y 3 por columna, cada columna con los números de su decena y
ordenada de arriba abajo. Es el único algoritmo no trivial del MVP.

**La autoridad de las reglas es SQL.** El espejo en TypeScript existe solo para
habilitar botones y tiene permitido equivocarse: nunca decide un resultado.

Dos decisiones de diseño de juego:

- **Marcado automático, canto manual.** El cartón se tacha solo pero hay que
  pulsar. Crea la tensión del bingo y mantiene el servidor en O(1) por canto en
  vez de O(cartones) por sondeo.
- **Gana el primero que canta.** En bingo presencial el premio se reparte entre
  quienes completan en la misma bola. Repartir es más justo pero mete lógica de
  empates; `select … for update` serializa y el primero se lo lleva. Revisable.

## Estado de la implementación

Hecho: motor puro, servicio local en memoria con rivales artificiales, interfaz
completa, migración SQL con las tres RPC, y el empaquetado a un HTML único.

Pendiente: proyecto de Supabase real y el adaptador `SupabaseRoundService`. Todo
pasa por `src/game/service.ts`, así que es un cambio de una función.

No abordado en este MVP: cuentas, economía de puntos y catálogo de canje.
