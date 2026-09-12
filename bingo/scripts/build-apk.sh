#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export ANDROID_HOME=/opt/android-sdk
export ANDROID_SDK_ROOT=/opt/android-sdk
export PATH="$ANDROID_HOME/platform-tools:$PATH"

echo "== regenerando proyecto nativo =="
npx expo prebuild --platform android --clean --no-install
# prebuild --clean borra android/ entera, keystore incluida.
cp /tmp/bingo-release.keystore.bak android/app/bingo-release.keystore
node scripts/patch-signing.mjs
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

echo "== gradle assembleRelease =="
cd android
./gradlew assembleRelease --no-daemon \
  -PBINGO_KEYSTORE=bingo-release.keystore \
  -PBINGO_KEYSTORE_PASSWORD="$(cat /tmp/kspass.txt)" \
  -PBINGO_KEY_ALIAS=bingo \
  -PBINGO_KEY_PASSWORD="$(cat /tmp/kspass.txt)"
