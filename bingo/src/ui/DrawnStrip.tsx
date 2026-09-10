import { StyleSheet, Text, View } from 'react-native';
import { c, type } from './tokens';

/** Las últimas cantadas, para quien levantó la vista un momento. */
export function DrawnStrip({ drawn }: { drawn: number[] }) {
  const recent = drawn.slice(-6, -1).reverse();
  if (recent.length === 0) return <View style={s.row} />;
  return (
    <View style={s.row}>
      {recent.map((n, i) => (
        <View key={`${n}-${i}`} style={[s.chip, { opacity: 1 - i * 0.15 }]}>
          <Text style={s.txt} allowFontScaling={false}>{n}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, height: 34, alignItems: 'center', justifyContent: 'center' },
  chip: {
    width: 34, height: 34, borderRadius: 17,
    borderWidth: 2, borderColor: c.feltEdge,
    alignItems: 'center', justifyContent: 'center',
  },
  txt: { fontFamily: type.ui, fontSize: 14, color: c.paper },
});
