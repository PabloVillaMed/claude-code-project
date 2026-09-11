import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.parchesmedellin.app',
  appName: 'Parche',
  webDir: 'dist',
  android: {
    // El catalogo viaja dentro del APK: la app abre sin conexion.
    allowMixedContent: false,
  },
}

export default config
