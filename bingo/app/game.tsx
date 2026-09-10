import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { getService } from '../src/game/service';
import type { Card } from '../src/game/card';
import type { RoundState } from '../src/game/engine';
import { availableClaims, completedRows, type ClaimKind } from '../src/game/rules';
import { Ball } from '../src/ui/Ball';
import { CardGrid } from '../src/ui/CardGrid';
import { DrawnStrip } from '../src/ui/DrawnStrip';
import { c, type } from '../src/ui/tokens';

const LABEL: Record<ClaimKind, string> = {
  line: 'Cantar línea',
  double_line: 'Cantar dos líneas',
  bingo: '¡Bingo!',
};
const WON: Record<ClaimKind, string> = {
  line: 'Línea',
  double_line: 'Dos líneas',
  bingo: 'Bingo',
};
const PLAYER_ID = 'yo';

export default function Game() {
  const { name, bots } = useLocalSearchParams<{ name?: string; bots?: string }>();
  const displayName = (name ?? 'Invitado').toString();
  const botCount = bots === '0' ? 0 : 4;
  const roundService = useMemo(() => getService(botCount), [botCount]);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [state, setState] = useState<RoundState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    roundService.joinRoom(botCount === 0 ? 'practica' : 'sala-principal', PLAYER_ID, displayName).then((r) => {
      if (!alive) return;
      setRoundId(r.roundId);
      setCard(r.card);
    });
    return () => {
      alive = false;
    };
  }, [displayName, roundService, botCount]);

  useEffect(() => {
    if (!roundId) return;
    let alive = true;
    const tick = async () => {
      const next = await roundService.getRoundState(roundId);
      if (alive) setState(next);
    };
    tick();
    const id = setInterval(tick, 400);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [roundId, roundService]);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2200);
  }, []);

  const drawn = useMemo(() => new Set(state?.drawn ?? []), [state?.drawn]);
  const done = useMemo(() => (card ? completedRows(card, drawn) : []), [card, drawn]);
  const taken = {
    line: !!state?.claims.line,
    double_line: !!state?.claims.double_line,
    bingo: !!state?.claims.bingo,
  };
  const canClaim = card && state?.status === 'running' ? availableClaims(card, drawn, taken) : [];

  const onClaim = async (kind: ClaimKind) => {
    if (!roundId) return;
    const res = await roundService.claim(roundId, PLAYER_ID, kind);
    if (res.ok) flash(`¡${WON[kind]} tuya! Bola ${res.ballIndex}`);
    else if (res.reason === 'already_claimed') flash('Se te adelantaron');
    else if (res.reason === 'not_satisfied') flash('Todavía no la tienes');
    else flash('La ronda no está en juego');
  };

  if (!card || !state) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <Text style={s.muted}>Repartiendo cartón…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const last = state.drawn.length ? state.drawn[state.drawn.length - 1] : null;
  const winners = (['line', 'double_line', 'bingo'] as ClaimKind[])
    .map((k) => ({ k, w: state.claims[k] }))
    .filter((x) => x.w);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.bar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={s.barLink}>Salir</Text>
          </Pressable>
          <Text style={s.barTxt}>
            {state.status === 'pending'
              ? `Empieza en ${Math.ceil(state.msToNextBall / 1000)}`
              : `Bola ${state.ballCount} de 90`}
          </Text>
        </View>

        <View style={s.column}>
        <View style={s.stage}>
          <Ball number={last} />
          <DrawnStrip drawn={state.drawn} />
        </View>

        {notice && (
          <View style={s.notice}>
            <Text style={s.noticeTxt}>{notice}</Text>
          </View>
        )}

        <CardGrid card={card} drawn={drawn} completedRows={done} />

        <View style={s.claims}>
          {state.status === 'finished' ? (
            <Text style={s.muted}>Ronda terminada</Text>
          ) : canClaim.length === 0 ? (
            <Text style={s.muted}>
              {state.status === 'pending' ? 'Mira tu cartón' : `Llevas ${
                card.filter((n) => n !== 0 && drawn.has(n)).length
              } de 15`}
            </Text>
          ) : (
            canClaim.map((kind) => (
              <Pressable
                key={kind}
                style={({ pressed }) => [s.claim, kind === 'bingo' && s.claimBingo, pressed && s.down]}
                onPress={() => onClaim(kind)}
              >
                <Text style={[s.claimTxt, kind === 'bingo' && s.claimTxtBingo]} allowFontScaling={false}>
                  {LABEL[kind]}
                </Text>
              </Pressable>
            ))
          )}
        </View>

        </View>
        {winners.length > 0 && (
          <View style={s.feed}>
            {winners.map(({ k, w }) => (
              <Text key={k} style={s.feedLine}>
                {WON[k]} · {w!.displayName} en la bola {w!.ballIndex}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.felt },
  body: { flexGrow: 1, paddingHorizontal: 18, paddingBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  barLink: { fontFamily: type.ui, fontSize: 15, color: c.laton },
  barTxt: { fontFamily: type.ui, fontSize: 15, color: c.paper, opacity: 0.8 },
  stage: { alignItems: 'center', gap: 18, paddingTop: 8 },
  column: { flex: 1, justifyContent: 'center', gap: 20 },
  notice: {
    backgroundColor: c.laton,
    borderRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  noticeTxt: { fontFamily: type.uiBold, fontSize: 15, color: c.ink },
  claims: { gap: 10, minHeight: 64, justifyContent: 'center', paddingTop: 4 },
  claim: { backgroundColor: c.carmin, borderRadius: 4, paddingVertical: 16, alignItems: 'center' },
  claimBingo: { backgroundColor: c.laton },
  claimTxtBingo: { color: c.ink },
  down: { transform: [{ translateY: 2 }] },
  claimTxt: { fontFamily: type.uiBold, fontSize: 18, color: c.paper },
  muted: { fontFamily: type.ui, fontSize: 15, color: c.paper, opacity: 0.55, textAlign: 'center' },
  feed: { gap: 4, paddingTop: 4 },
  feedLine: { fontFamily: type.ui, fontSize: 13, color: c.paper, opacity: 0.6, textAlign: 'center' },
});
