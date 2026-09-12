# Bingo 90

App de bingo de 90 bolas. Expo + React Native, con Postgres como árbitro.

Diseño y decisiones: [`docs/superpowers/specs/2026-09-10-bingo-90-motor-diseno.md`](../docs/superpowers/specs/2026-09-10-bingo-90-motor-diseno.md)

## Arrancar

```bash
npm install
npm run web        # navegador
npm start          # Expo Go en el móvil
npm test           # 20 pruebas del motor
npm run pack       # un único HTML autocontenido en dist-single/
```

## Compilar el APK

Necesita Android SDK (plataforma 36, build-tools 36, NDK 27) y `ANDROID_HOME`.

```bash
./scripts/build-apk.sh
```

Regenera el proyecto nativo, reaplica la firma y compila en modo release.
Las credenciales de firma se pasan por `-P` en el momento de compilar y
**nunca** se escriben en el repositorio; `android/` y los `.keystore` están
en `.gitignore`. Sin esas credenciales la build cae a la clave de
depuración, que sirve para probar en local pero no para distribuir.

## Cómo está montado

```
src/game/     motor puro, sin dependencias de React
  card.ts       generación del cartón 9x3
  rules.ts      línea / dos líneas / bingo
  rng.ts        aleatoriedad determinista y auditable
  engine.ts     el contrato del servidor
  localEngine.ts   implementación en memoria, con rivales artificiales
  service.ts    ← el único punto que cambia al conectar Supabase
src/ui/       componentes visuales
app/          pantallas (expo-router)
supabase/     migración y pruebas SQL
```

**El servidor manda.** El cliente nunca conoce las bolas futuras: pide el estado
y recibe solo el prefijo que el reloj autoriza. Las reglas viven en SQL; el
espejo en TypeScript solo habilita botones y tiene permitido equivocarse.

## Probar el SQL

Requiere PostgreSQL 16 local:

```bash
psql -f supabase/tests/harness.sql      # simula auth.uid(), solo en local
psql -f supabase/migrations/0001_bingo.sql
npm run db:test
```

## Falta

Proyecto de Supabase y el adaptador `SupabaseRoundService`. Hoy corre contra la
implementación local, así que se juega en un solo dispositivo.
