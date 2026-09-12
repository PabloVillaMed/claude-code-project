/** Reaplica la firma de release tras un prebuild, que regenera android/. */
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'android/app/build.gradle';
let s = readFileSync(p, 'utf8');

if (!s.includes('signingConfigs.release')) {
  s = s.replace(
    /(signingConfigs \{\s*\n\s*debug \{[\s\S]*?\n        \}\n)/,
    `$1        release {
            // Credenciales por -P al construir: nunca se escriben en el repo.
            // Sin ellas cae a la clave de depuración, útil en local.
            def ks = findProperty('BINGO_KEYSTORE') ?: 'debug.keystore'
            def pw = findProperty('BINGO_KEYSTORE_PASSWORD') ?: 'android'
            storeFile file(ks)
            storePassword pw
            keyAlias findProperty('BINGO_KEY_ALIAS') ?: 'androiddebugkey'
            keyPassword findProperty('BINGO_KEY_PASSWORD') ?: pw
        }
`);
  s = s.replace(
    /\/\/ Caution! In production[\s\S]*?signingConfig signingConfigs\.debug/,
    'signingConfig signingConfigs.release',
  );
  writeFileSync(p, s);
  console.log('√ firma de release aplicada');
} else {
  console.log('· la firma de release ya estaba');
}
