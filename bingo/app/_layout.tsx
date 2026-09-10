import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, AlfaSlabOne_400Regular } from '@expo-google-fonts/alfa-slab-one';
import { Archivo_600SemiBold, Archivo_700Bold } from '@expo-google-fonts/archivo';
import { View } from 'react-native';
import { c } from '../src/ui/tokens';

export default function Layout() {
  const [ready, error] = useFonts({ AlfaSlabOne_400Regular, Archivo_600SemiBold, Archivo_700Bold });
  // Si una fuente no carga, el juego sigue: se cae a la del sistema, no a una
  // pantalla en blanco. Importa al empaquetar en un solo fichero.
  if (!ready && !error) return <View style={{ flex: 1, backgroundColor: c.felt }} />;

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.felt } }}
      />
    </>
  );
}
