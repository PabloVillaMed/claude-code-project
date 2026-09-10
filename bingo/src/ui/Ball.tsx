import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { c, type } from './tokens';

/** La bolilla cantada. Es lo único ruidoso de la pantalla. */
export function Ball({ number }: { number: number | null }) {
  const spin = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (number === null) return;
    spin.setValue(0);
    Animated.timing(spin, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [number, spin]);

  const scale = spin.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.72, 1.06, 1] });

  return (
    <View style={s.wrap}>
      <Animated.View style={[s.ball, { transform: [{ scale }] }]}>
        <View style={s.ring} />
        <Text style={s.num} allowFontScaling={false}>
          {number ?? '·'}
        </Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ball: {
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: c.laton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    top: 9,
    left: 9,
    right: 9,
    bottom: 9,
    borderRadius: 65,
    borderWidth: 3,
    borderColor: c.latonDeep,
  },
  num: { fontFamily: type.slab, fontSize: 64, color: c.ink, lineHeight: 78 },
});
