// Misiones del MVP: domicilio contrarreloj, carrera de motos por checkpoints y
// "limpiar el parche". Máquina de estados pura; el juego ejecuta los eventos.

import { dist2D } from './math.js';
import { GRID, roadLine } from './terrain.js';

export function createMissionDefs(city) {
  const poi = (id) => city.pois.find((p) => p.id === id);
  const node = (i, j) => ({ x: roadLine(i, GRID.nx), z: roadLine(j, GRID.nz) });
  return {
    domicilio: {
      id: 'domicilio',
      title: 'Domicilio express',
      giver: 'parque',
      reward: 900,
      stages: [
        { kind: 'goto', target: poi('museo'), radius: 4, text: 'Recoge el pedido en la Casa Museo Pedro Nel Gómez' },
        { kind: 'goto', target: poi('metro'), radius: 5, text: 'Entrega el pedido en la Estación Universidad', timeLimit: 150 },
      ],
    },
    carrera: {
      id: 'carrera',
      title: 'Pique en el barrio',
      giver: 'taller',
      reward: 1600,
      spawnVehicle: 'moto',
      timeLimit: 140,
      stages: [
        [8, 5],
        [8, 2],
        [5, 2],
        [5, 0],
        [2, 0],
        [2, 5],
        [4, 6],
        [7, 6],
      ].map(([i, j], k, arr) => ({
        kind: 'checkpoint',
        target: node(i, j),
        radius: 9,
        requireVehicle: true,
        text: `Checkpoint ${k + 1}/${arr.length}`,
      })),
    },
    parche: {
      id: 'parche',
      title: 'Limpiar el parche',
      giver: 'cancha',
      reward: 2500,
      spawnGang: { at: poi('cementerio'), count: 5 },
      stages: [
        { kind: 'goto', target: poi('cementerio'), radius: 25, text: 'Ve al Cementerio San Pedro: el parche está azotando' },
        { kind: 'eliminate', text: 'Neutraliza al parche' },
      ],
    },
  };
}

export class MissionSystem {
  constructor(defs) {
    this.defs = defs;
    this.active = null;
    this.completed = new Set();
    this.lastResult = null;
  }

  get stage() {
    return this.active ? this.active.def.stages[this.active.stage] : null;
  }

  available(poiId) {
    if (this.active) return null;
    return Object.values(this.defs).find((d) => d.giver === poiId) ?? null;
  }

  start(id) {
    const def = this.defs[id];
    if (!def || this.active) return [];
    this.active = { def, stage: 0, timer: def.timeLimit ?? def.stages[0].timeLimit ?? null, elapsed: 0 };
    const events = [{ type: 'start', mission: def }];
    if (def.spawnVehicle) events.push({ type: 'spawnVehicle', vehicle: def.spawnVehicle });
    if (def.spawnGang) events.push({ type: 'spawnGang', ...def.spawnGang });
    events.push({ type: 'objective', text: def.stages[0].text, target: def.stages[0].target ?? null });
    return events;
  }

  cancel(reason = 'Misión cancelada') {
    if (!this.active) return [];
    const def = this.active.def;
    this.active = null;
    this.lastResult = { id: def.id, ok: false };
    return [{ type: 'fail', mission: def, reason }];
  }

  /** ctx = {x, z, inVehicle, gangAlive, dead} */
  update(dt, ctx) {
    if (!this.active) return [];
    const a = this.active;
    const events = [];
    a.elapsed += dt;
    if (ctx.dead) return this.cancel('Te hirieron: misión fallida');
    if (a.timer !== null) {
      a.timer -= dt;
      if (a.timer <= 0) return this.cancel('Se acabó el tiempo');
    }
    const st = a.def.stages[a.stage];
    let done = false;
    if (st.kind === 'goto' || st.kind === 'checkpoint') {
      if (st.requireVehicle && !ctx.inVehicle) {
        // Sigue contando el tiempo; solo cuenta si pasa en vehículo.
      } else if (dist2D(ctx.x, ctx.z, st.target.x, st.target.z) <= st.radius) done = true;
    } else if (st.kind === 'eliminate') {
      done = ctx.gangAlive === 0;
    }
    if (done) {
      events.push({ type: 'stageComplete', index: a.stage });
      a.stage += 1;
      if (a.stage >= a.def.stages.length) {
        this.completed.add(a.def.id);
        this.active = null;
        this.lastResult = { id: a.def.id, ok: true };
        events.push({ type: 'complete', mission: a.def, reward: a.def.reward });
      } else {
        const next = a.def.stages[a.stage];
        if (next.timeLimit) a.timer = next.timeLimit;
        events.push({ type: 'objective', text: next.text, target: next.target ?? null });
      }
    }
    return events;
  }
}
