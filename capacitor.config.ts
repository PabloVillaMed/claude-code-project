import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.parchesmedellin.app',
  appName: 'Parches Medellin',
  webDir: 'dist',
  android: {
    // El catalogo viaja dentro del APK: la app abre sin conexion.
    allowMixedContent: false,
  },
}

export default config
