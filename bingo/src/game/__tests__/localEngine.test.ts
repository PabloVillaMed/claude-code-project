import { describe, it, expect } from 'vitest';
import { LocalRoundService } from '../localEngine';
import { BALL_INTERVAL_MS, TOTAL_BALLS } from '../engine';
import { satisfies } from '../rules';

/** Reloj controlado: nada de esperas reales en las pruebas. */
function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const START_DELAY = 5000;

describe('LocalRoundService', () => {
  it('no revela ninguna bola antes de que arranque la ronda', async () => {
    const clock = makeClock();
    const svc = new LocalRoundService(clock.now, 0);
    const { roundId } = await svc.joinRoom('sala', 'p1', 'Yo');

    const state = await svc.getRoundState(roundId);
    expect(state.status).toBe('pending');
    expect(state.drawn).toEqual([]);
  });

  it('revela las bolas una a una según avanza el reloj', async () => {
    const clock = makeClock();
    const svc = new LocalRoundService(clock.now, 0);
    const { roundId } = await svc.joinRoom('sala', 'p1', 'Yo');

    clock.advance(START_DELAY);
    expect((await svc.getRoundState(roundId)).drawn).toHaveLength(1);

    clock.advance(BALL_INTERVAL_MS * 4);
    expect((await svc.getRoundState(roundId)).drawn).toHaveLength(5);
  });

  it('nunca entrega más bolas de las cantadas', async () => {
    const clock = makeClock();
    const svc = new LocalRoundService(clock.now, 0);
    const { roundId } = await svc.joinRoom('sala', 'p1', 'Yo');
    clock.advance(START_DELAY + BALL_INTERVAL_MS * 9);

    const state = await svc.getRoundState(roundId);
    expect(state.drawn).toHaveLength(10);
    expect(new Set(state.drawn).size).toBe(10);
  });

  it('rechaza cantar antes de que el cartón lo cumpla', async () => {
    const clock = makeClock();
    const svc = new LocalRoundService(clock.now, 0);
    const { roundId } = await svc.joinRoom('sala', 'p1', 'Yo');
    clock.advance(START_DELAY);

    expect(await svc.claim(roundId, 'p1', 'bingo')).toEqual({ ok: false, reason: 'not_satisfied' });
  });

  it('rechaza cantar antes de que la ronda arranque', async () => {
    const clock = makeClock();
    const svc = new LocalRoundService(clock.now, 0);
    const { roundId } = await svc.joinRoom('sala', 'p1', 'Yo');

    expect(await svc.claim(roundId, 'p1', 'line')).toEqual({ ok: false, reason: 'not_running' });
  });

  it('acepta el canto en cuanto el cartón lo cumple de verdad', async () => {
    const clock = makeClock();
    const svc = new LocalRoundService(clock.now, 0);
    const { roundId, card } = await svc.joinRoom('sala', 'p1', 'Yo');
    clock.advance(START_DELAY);

    let accepted = false;
    for (let i = 0; i < TOTAL_BALLS; i++) {
      const state = await svc.getRoundState(roundId);
      if (satisfies(card, new Set(state.drawn), 'line')) {
        expect(await svc.claim(roundId, 'p1', 'line')).toMatchObject({ ok: true, kind: 'line' });
        accepted = true;
        break;
      }
      clock.advance(BALL_INTERVAL_MS);
    }
    expect(accepted).toBe(true);
  });

  it('no deja cantar dos veces el mismo premio', async () => {
    const clock = makeClock();
    const svc = new LocalRoundService(clock.now, 0);
    const { roundId, card } = await svc.joinRoom('sala', 'p1', 'Yo');
    clock.advance(START_DELAY);

    for (let i = 0; i < TOTAL_BALLS; i++) {
      const state = await svc.getRoundState(roundId);
      if (satisfies(card, new Set(state.drawn), 'line')) break;
      clock.advance(BALL_INTERVAL_MS);
    }
    expect(await svc.claim(roundId, 'p1', 'line')).toMatchObject({ ok: true });
    expect(await svc.claim(roundId, 'p1', 'line')).toEqual({ ok: false, reason: 'already_claimed' });
  });

  it('termina la ronda al agotar las 90 bolas', async () => {
    const clock = makeClock();
    const svc = new LocalRoundService(clock.now, 0);
    const { roundId } = await svc.joinRoom('sala', 'p1', 'Yo');
    clock.advance(START_DELAY + BALL_INTERVAL_MS * TOTAL_BALLS);

    const state = await svc.getRoundState(roundId);
    expect(state.status).toBe('finished');
    expect(state.drawn).toHaveLength(TOTAL_BALLS);
  });

  it('los bots cantan solos cuando les toca', async () => {
    const clock = makeClock();
    const svc = new LocalRoundService(clock.now, 4);
    const { roundId } = await svc.joinRoom('sala', 'p1', 'Yo');
    clock.advance(START_DELAY + BALL_INTERVAL_MS * TOTAL_BALLS);

    const state = await svc.getRoundState(roundId);
    expect(state.claims.line).not.toBeNull();
    expect(state.claims.bingo).not.toBeNull();
  });
});
