import { generateCard, type Card } from './card';
import { drawSequence, mulberry32, seedFromString } from './rng';
import { availableClaims, completedRows, satisfies, type ClaimKind } from './rules';
import {
  BALL_INTERVAL_MS, TOTAL_BALLS, ballsDrawnAt,
  type ClaimResult, type RoundService, type RoundState, type Winner,
} from './engine';

type Player = { id: string; displayName: string; card: Card; isBot: boolean; reaction: number };

type Round = {
  id: string;
  seed: string;
  sequence: number[];          // privado: nunca sale entero de aquí
  startedAt: number;
  intervalMs: number;
  players: Player[];
  claims: Record<ClaimKind, Winner | null>;
  finishedAt: number | null;
};

const BOT_NAMES = ['Lucía', 'Andrés', 'Camila', 'Mateo', 'Valentina', 'Joaquín', 'Renata'];

/**
 * Servidor simulado en memoria. Reproduce exactamente lo que hará Postgres:
 * la secuencia se genera al crear la ronda, se guarda entera y solo se revela
 * el prefijo que el reloj autoriza.
 */
export class LocalRoundService implements RoundService {
  private rounds = new Map<string, Round>();
  private byRoom = new Map<string, string>();

  constructor(private now: () => number = Date.now, private botCount = 4) {}

  async joinRoom(roomId: string, playerId: string, displayName: string) {
    let roundId = this.byRoom.get(roomId);
    let round = roundId ? this.rounds.get(roundId) : undefined;

    if (!round || round.finishedAt !== null) {
      round = this.createRound(roomId);
      roundId = round.id;
    }

    let player = round.players.find((p) => p.id === playerId);
    if (!player) {
      player = {
        id: playerId,
        displayName,
        card: generateCard(`${round.id}:${playerId}`),
        isBot: false,
        reaction: 0,
      };
      round.players.push(player);
    }
    return { roundId: round.id, card: player.card };
  }

  private createRound(roomId: string): Round {
    const id = `r${Math.random().toString(36).slice(2, 10)}`;
    const seed = `${roomId}:${id}`;
    const rnd = mulberry32(seedFromString(seed));
    const round: Round = {
      id,
      seed,
      sequence: drawSequence(rnd),
      startedAt: this.now() + 5000, // 5s de cortesía para ver el cartón
      intervalMs: BALL_INTERVAL_MS,
      players: [],
      claims: { line: null, double_line: null, bingo: null },
      finishedAt: null,
    };
    for (let i = 0; i < this.botCount; i++) {
      round.players.push({
        id: `bot-${i}`,
        displayName: BOT_NAMES[i % BOT_NAMES.length],
        card: generateCard(`${id}:bot-${i}`),
        isBot: true,
        reaction: 1 + Math.floor(rnd() * 3), // tarda 1-3 bolas en reaccionar
      });
    }
    this.rounds.set(id, round);
    this.byRoom.set(roomId, id);
    return round;
  }

  async getRoundState(roundId: string): Promise<RoundState> {
    const round = this.mustGet(roundId);
    const count = ballsDrawnAt(round.startedAt, this.now(), round.intervalMs);
    this.runBots(round, count);
    if (count >= TOTAL_BALLS && round.finishedAt === null) round.finishedAt = this.now();

    const status = round.finishedAt !== null ? 'finished' : count === 0 ? 'pending' : 'running';
    const elapsed = this.now() - round.startedAt;
    return {
      roundId,
      status,
      drawn: round.sequence.slice(0, count),
      ballCount: count,
      msToNextBall:
        count === 0
          ? Math.max(0, round.startedAt - this.now())
          : round.intervalMs - (elapsed % round.intervalMs),
      claims: { ...round.claims },
    };
  }

  /** Los bots cantan solo cuando de verdad les toca, con retraso humano. */
  private runBots(round: Round, count: number) {
    if (count === 0 || round.finishedAt !== null) return;

    for (const bot of round.players.filter((p) => p.isBot)) {
      for (const kind of ['line', 'double_line', 'bingo'] as ClaimKind[]) {
        if (round.claims[kind]) continue;
        const reactedAt = this.firstBallFor(round, bot.card, kind);
        if (reactedAt !== null && count >= reactedAt + bot.reaction) {
          round.claims[kind] = {
            playerId: bot.id,
            displayName: bot.displayName,
            ballIndex: count,
          };
          if (kind === 'bingo') round.finishedAt = this.now();
        }
      }
    }
  }

  /** En qué bola el cartón cumplió el canto por primera vez. */
  private firstBallFor(round: Round, card: Card, kind: ClaimKind): number | null {
    const drawn = new Set<number>();
    for (let i = 0; i < round.sequence.length; i++) {
      drawn.add(round.sequence[i]);
      if (satisfies(card, drawn, kind)) return i + 1;
    }
    return null;
  }

  async claim(roundId: string, playerId: string, kind: ClaimKind): Promise<ClaimResult> {
    const round = this.mustGet(roundId);
    const count = ballsDrawnAt(round.startedAt, this.now(), round.intervalMs);
    if (count === 0 || round.finishedAt !== null) return { ok: false, reason: 'not_running' };
    if (round.claims[kind]) return { ok: false, reason: 'already_claimed' };

    const player = round.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, reason: 'no_card' };

    const drawn = new Set(round.sequence.slice(0, count));
    if (!satisfies(player.card, drawn, kind)) return { ok: false, reason: 'not_satisfied' };

    round.claims[kind] = { playerId, displayName: player.displayName, ballIndex: count };
    if (kind === 'bingo') round.finishedAt = this.now();
    return { ok: true, kind, ballIndex: count };
  }

  private mustGet(roundId: string): Round {
    const round = this.rounds.get(roundId);
    if (!round) throw new Error(`ronda desconocida: ${roundId}`);
    return round;
  }
}

export { availableClaims, completedRows };
