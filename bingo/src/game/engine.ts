import type { Card } from './card';
import type { ClaimKind } from './rules';

export type RoundStatus = 'pending' | 'running' | 'finished';

export type Winner = { playerId: string; displayName: string; ballIndex: number };

export type RoundState = {
  roundId: string;
  status: RoundStatus;
  /** Solo las bolas ya extraídas. Las futuras nunca cruzan esta frontera. */
  drawn: number[];
  ballCount: number;
  msToNextBall: number;
  claims: Record<ClaimKind, Winner | null>;
};

export type ClaimResult =
  | { ok: true; kind: ClaimKind; ballIndex: number }
  | { ok: false; reason: 'not_running' | 'already_claimed' | 'not_satisfied' | 'no_card' };

/**
 * Contrato del servidor. La implementación local y las RPC de Supabase
 * lo cumplen igual: quien llama no sabe cuál tiene detrás.
 */
export interface RoundService {
  joinRoom(roomId: string, playerId: string, displayName: string): Promise<{ roundId: string; card: Card }>;
  getRoundState(roundId: string): Promise<RoundState>;
  claim(roundId: string, playerId: string, kind: ClaimKind): Promise<ClaimResult>;
}

export const BALL_INTERVAL_MS = 3000;
export const TOTAL_BALLS = 90;

/** Bolas visibles según el reloj. Única fuente de la verdad temporal. */
export function ballsDrawnAt(startedAt: number, now: number, intervalMs: number): number {
  if (now < startedAt) return 0;
  return Math.min(TOTAL_BALLS, Math.floor((now - startedAt) / intervalMs) + 1);
}
