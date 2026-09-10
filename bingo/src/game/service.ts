import { LocalRoundService } from './localEngine';
import type { RoundService } from './engine';

const cache = new Map<number, RoundService>();

/**
 * Único punto donde se elige la implementación. Cuando exista el proyecto de
 * Supabase, aquí entra SupabaseRoundService y no cambia nada más en la app.
 */
export function getService(bots = 4): RoundService {
  let svc = cache.get(bots);
  if (!svc) {
    svc = new LocalRoundService(Date.now, bots);
    cache.set(bots, svc);
  }
  return svc;
}
