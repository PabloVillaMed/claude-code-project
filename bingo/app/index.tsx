import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { c, type } from '../src/ui/tokens';

export default function Lobby() {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.body}>
        <View style={s.brand}>
          <Text style={s.title} allowFontScaling={false}>Bingo</Text>
          <Text style={s.subtitle}>90 bolas, cartón de nueve columnas</Text>
        </View>

        <View style={s.form}>
          <Text style={s.label}>¿Cómo te llamamos en la mesa?</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="Tu nombre"
            placeholderTextColor={c.inkSoft}
            maxLength={16}
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={() => trimmed && router.push(`/game?name=${encodeURIComponent(trimmed)}`)}
          />
          <Pressable
            style={({ pressed }) => [s.cta, !trimmed && s.ctaOff, pressed && s.ctaDown]}
            disabled={!trimmed}
            onPress={() => router.push(`/game?name=${encodeURIComponent(trimmed)}`)}
          >
            <Text style={s.ctaTxt} allowFontScaling={false}>Entrar a la mesa</Text>
          </Pressable>
        </View>

        <Pressable
          disabled={!trimmed}
          onPress={() => router.push(`/game?bots=0&name=${encodeURIComponent(trimmed)}`)}
        >
          <Text style={[s.foot, !trimmed && s.footOff]}>
            Prefiero practicar sin rivales
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.felt },
  body: { flex: 1, paddingHorizontal: 28, justifyContent: 'center', gap: 44 },
  brand: { gap: 6 },
  title: { fontFamily: type.slab, fontSize: 62, color: c.laton, lineHeight: 72 },
  subtitle: { fontFamily: type.ui, fontSize: 16, color: c.paper, opacity: 0.75 },
  form: { gap: 12 },
  label: { fontFamily: type.ui, fontSize: 15, color: c.paper, opacity: 0.8 },
  input: {
    backgroundColor: c.paper,
    borderRadius: 4,
    borderWidth: 3,
    borderColor: c.ink,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontFamily: type.uiBold,
    fontSize: 19,
    color: c.ink,
  },
  cta: {
    backgroundColor: c.carmin,
    borderRadius: 4,
    paddingVertical: 17,
    alignItems: 'center',
    marginTop: 6,
  },
  ctaOff: { opacity: 0.4 },
  ctaDown: { transform: [{ translateY: 2 }] },
  ctaTxt: { fontFamily: type.uiBold, fontSize: 18, color: c.paper },
  foot: { fontFamily: type.ui, fontSize: 14, color: c.laton, opacity: 0.9, textAlign: 'center' },
  footOff: { opacity: 0.3 },
});
