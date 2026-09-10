import { StyleSheet, Text, View } from 'react-native';
import { COLS, ROWS, type Card } from '../game/card';
import { c, type } from './tokens';

/** El cartón: papel impreso, no una tarjeta de interfaz. */
export function CardGrid({
  card,
  drawn,
  completedRows,
}: {
  card: Card;
  drawn: ReadonlySet<number>;
  completedRows: number[];
}) {
  return (
    <View style={s.paper}>
      {Array.from({ length: ROWS }, (_, row) => (
        <View key={row} style={[s.row, completedRows.includes(row) && s.rowDone]}>
          {Array.from({ length: COLS }, (_, col) => {
            const n = card[row * COLS + col];
            const marked = n !== 0 && drawn.has(n);
            return (
              <View key={col} style={[s.cell, n === 0 && s.blank]}>
                {marked && <View style={s.dab} />}
                {n !== 0 && (
                  <Text style={[s.num, marked && s.numMarked]} allowFontScaling={false}>
                    {n}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  paper: {
    backgroundColor: c.paper,
    borderRadius: 4,
    padding: 6,
    borderWidth: 3,
    borderColor: c.ink,
    width: '100%',
  },
  row: { flexDirection: 'row' },
  rowDone: { backgroundColor: 'rgba(196,42,63,0.10)' },
  cell: {
    flex: 1,
    aspectRatio: 0.86,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.paperShade,
  },
  blank: { backgroundColor: c.paperShade },
  dab: {
    position: 'absolute',
    width: '86%',
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: c.carmin,
    opacity: 0.9,
  },
  num: { fontFamily: type.uiBold, fontSize: 17, color: c.ink },
  numMarked: { color: c.paper },
});
