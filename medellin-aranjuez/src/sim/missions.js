// Misiones: domicilio contrarreloj, carrera de motos por checkpoints, "limpiar
// el parche" y los encargos de los locales típicos (mandingas, granizados…).
// Máquina de estados pura; el juego ejecuta los eventos.

import { dist2D } from './math.js';

export function createMissionDefs(city) {
  const poi = (id) => city.pois.find((p) => p.id === id);
  // Intersección activa (de 3+ vías si hay) más cercana a un punto.
  const node = (x, z) => {
    let best = null;
    let bd = Infinity;
    for (const n of city.nodes) {
      if (!n.active) continue;
      const d = dist2D(n.x, n.z, x, z) - (n.links.length >= 3 ? 25 : 0);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return { x: best.x, z: best.z };
  };
  // Pique: del taller a Moravia, la Caribe y de vuelta por San Cayetano.
  const route = ['consuelo', 'moravia', 'metro', 'cancha', 'cayetano', 'comfama', 'taller'].map((id) => poi(id)).filter(Boolean).map((p) => node(p.x, p.z));
  // Tiempo para ir de un punto a otro por calles reales a `speed` m/s.
  const legTime = (pts, speed, extra) => {
    let d = 0;
    for (let k = 1; k < pts.length; k++) d += dist2D(pts[k].x, pts[k].z, pts[k - 1].x, pts[k - 1].z);
    return Math.round((d * 1.5) / speed + extra);
  };
  const has = (...ids) => ids.every((id) => poi(id));
  let raceLen = 0;
  const start = poi('taller') ?? route[0];
  route.forEach((c, k) => (raceLen += dist2D(c.x, c.z, k ? route[k - 1].x : start.x, k ? route[k - 1].z : start.z)));
  const defs = {
    domicilio: {
      id: 'domicilio',
      title: 'Domicilio express',
      giver: 'parque',
      reward: 900,
      stages: [
        { kind: 'goto', target: poi('museo'), radius: 4, text: 'Recoge el pedido en la Casa Museo Pedro Nel Gómez' },
        { kind: 'goto', target: poi('metro'), radius: 5, text: 'Entrega el pedido en la Estación Caribe del Metro', timeLimit: 150 },
      ],
    },
    carrera: {
      id: 'carrera',
      title: 'Pique en el barrio',
      giver: 'taller',
      reward: 1600,
      spawnVehicle: 'moto',
      // Las calles reales dan vueltas: ~1,5× la distancia recta a 13 m/s.
      timeLimit: Math.round((raceLen * 1.5) / 13 + 25),
      stages: route.map((target, k, arr) => ({
        kind: 'checkpoint',
        target,
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
      spawnGang: { at: poi('moravia'), count: 5 },
      stages: [
        { kind: 'goto', target: poi('moravia'), radius: 25, text: 'Sube al Morro de Moravia: el parche está azotando' },
        { kind: 'eliminate', text: 'Neutraliza al parche' },
      ],
    },
  };
  // ---- Encargos de los locales típicos (solo si el local quedó en el mapa).
  if (has('mandingas92', 'mandingas94', 'iglesia', 'hospital', 'cayetano')) {
    const stops = ['mandingas94', 'hospital', 'iglesia', 'cayetano'].map(poi);
    defs.mandingas = {
      id: 'mandingas',
      title: 'Domicilios de mandingas',
      giver: 'mandingas92',
      reward: 1400,
      spawnVehicle: 'moto',
      spawnAt: 'mandingas92',
      timeLimit: legTime([poi('mandingas92'), ...stops], 11, 40),
      stages: [
        { kind: 'goto', target: stops[0], radius: 6, text: 'Recoge el pedido grande en Mandingas La 94' },
        { kind: 'goto', target: stops[1], radius: 7, text: 'Entrega 1/3: las enfermeras del hospital' },
        { kind: 'goto', target: stops[2], radius: 7, text: 'Entrega 2/3: el sacristán de la iglesia de Aranjuez' },
        { kind: 'goto', target: stops[3], radius: 7, text: 'Entrega 3/3: la señora del Parque de San Cayetano' },
      ],
    };
  }
  if (has('granizados92', 'mirador')) {
    defs.granizado = {
      id: 'granizado',
      title: 'Granizado antes de que se derrita',
      giver: 'granizados92',
      reward: 700,
      stages: [{ kind: 'goto', target: poi('mirador'), radius: 6, text: 'Sube el granizado al Mirador de Aranjuez antes de que se vuelva agua', timeLimit: legTime([poi('granizados92'), poi('mirador')], 9, 30) }],
    };
  }
  if (has('laspatatas', 'migao')) {
    defs.patatas = {
      id: 'patatas',
      title: 'El domiciliario de Las Patatas',
      giver: 'laspatatas',
      reward: 1800,
      spawnGang: { at: poi('migao'), count: 3 },
      stages: [
        { kind: 'goto', target: poi('migao'), radius: 25, text: 'Al domiciliario lo están azarando por El Migao: ve a ayudarlo' },
        { kind: 'eliminate', text: 'Espanta a los que lo querían robar' },
        { kind: 'goto', target: poi('laspatatas'), radius: 5, text: 'Vuelve a Las Patatas a contar que todo bien' },
      ],
    };
  }
  if (has('marinillos', 'iglesia')) {
    defs.novena = {
      id: 'novena',
      title: 'Buñuelos pa la novena',
      giver: 'marinillos',
      reward: 600,
      stages: [{ kind: 'goto', target: poi('iglesia'), radius: 7, text: 'Lleva los buñuelos calienticos a la iglesia de Aranjuez', timeLimit: legTime([poi('marinillos'), poi('iglesia')], 6, 40) }],
    };
  }
  const tour = ['museo', 'cayetano', 'metro', 'moravia', 'parque'].filter((id) => poi(id));
  if (poi('mirador') && tour.length >= 3) {
    defs.recorrido = {
      id: 'recorrido',
      title: 'Fotos del barrio',
      giver: 'mirador',
      reward: 1200,
      stages: tour.map((id, k) => ({ kind: 'goto', target: poi(id), radius: 10, text: `Foto ${k + 1}/${tour.length}: ${poi(id).name}` })),
    };
  }
  return defs;
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
    if (def.spawnVehicle) events.push({ type: 'spawnVehicle', vehicle: def.spawnVehicle, at: def.spawnAt ?? 'taller' });
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
