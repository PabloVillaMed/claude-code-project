// Actividades cotidianas del barrio (lógica pura, sin three.js): dónde pasan
// (colgar ropa en los balcones, fumar o hablar por celular recostado a la
// fachada, barrer el andén, dominó frente a la tienda, lavar la moto, el
// picadito en la cancha o en una calle tranquila) y la física del balón con
// el partido. game/activities.js las pone en escena cerca del jugador.

import { clamp, dampAngle, yawFromDir } from './math.js';
import { makeRng } from './rng.js';
import { facadeLayout } from './facades.js';

/** Tipos de actividad y cuántas personas ocupa cada una (presupuesto). */
export const ACTIVITY_COST = { ropa: 1, fumar: 1, celular: 1, barrer: 1, domino: 4, lavar: 1, futbol: 8 };

// ------------------------------------------------------------------ lugares
/**
 * Punto de la fachada `f` (sim/facades.js faceFrame): `u` a lo largo del
 * frente, `off` hacia la calle.
 */
export function facadePoint(f, u, off) {
  return { x: f.x0 + f.rx * u + f.nx * off, z: f.z0 + f.rz * u + f.nz * off };
}

/**
 * Lugares de las actividades del barrio (deterministas). `city`: la ciudad de
 * cityLayout. Opciones:
 *   isFree(x, z): ¿se puede estar de pie ahí? (andén, sin muro ni calzada);
 *   layoutOf(b, i): distribución de la fachada (por defecto facadeLayout);
 *   edges: aristas viales activas para el fútbol callejero.
 * Devuelve [{kind, x, z, yaw, ...}].
 */
export function activitySpots(city, { isFree = () => true, layoutOf = facadeLayout, edges = city.edges ?? [] } = {}) {
  const out = [];
  const taken = []; // separación mínima entre actividades de la misma cuadra
  const far = (x, z, r) => taken.every((t) => (t.x - x) ** 2 + (t.z - z) ** 2 > r * r);
  // Sillas y ventas del andén: ahí ya hay gente.
  for (const p of city.props ?? []) if (p.type === 'chair' || p.type === 'vendor') taken.push({ x: p.x, z: p.z });

  const buildings = city.buildings ?? [];
  for (let bi = 0; bi < buildings.length; bi++) {
    const b = buildings[bi];
    const L = layoutOf(b, bi);
    if (!L) continue;
    const rng = makeRng(0xac71 + bi * 131);
    const f = L.face;
    const yaw = yawFromDir(f.nx, f.nz); // mirando a la calle
    const gy = b.groundY ?? 0;

    // Ropa en el balcón: la señora parada sobre la losa, frente a la cuerda.
    if (L.balconies.length && rng.chance(0.35)) {
      const bal = L.balconies[rng.int(0, L.balconies.length - 1)];
      const u0 = bal.u0 + 0.35;
      const u1 = bal.u1 - 0.35;
      if (u1 - u0 > 1.2) {
        const p = facadePoint(f, (u0 + u1) / 2, 0.42);
        const a = facadePoint(f, bal.u0 + 0.08, 0.72);
        const c = facadePoint(f, bal.u1 - 0.08, 0.72);
        out.push({ kind: 'ropa', x: p.x, z: p.z, y: gy + bal.v + 0.03, yaw, building: bi, laundry: !!L.laundry, line: { ax: a.x, az: a.z, bx: c.x, bz: c.z }, walk: { ...facadePoint(f, u0, 0.42), x1: facadePoint(f, u1, 0.42).x, z1: facadePoint(f, u1, 0.42).z }, dir: { x: f.rx, z: f.rz } });
      }
    }

    // Primer piso: una sola actividad por casa (a veces ninguna).
    const r = rng.next();
    const doors = L.openings.filter((o) => o.floor === 0 && (o.kind === 'door' || o.kind === 'garage'));
    if (L.shop && r < 0.3) {
      // Dominó frente a la tienda: mesa plástica y cuatro sillas en el andén.
      const u = (L.shop.u0 + L.shop.u1) / 2;
      const c = facadePoint(f, u, 1.75);
      const corners = [
        [-1.05, -1.05],
        [1.05, -1.05],
        [-1.05, 1.05],
        [1.05, 1.05],
      ].map(([du, dv]) => facadePoint(f, u + du, 1.75 + dv));
      if (corners.every((q) => isFree(q.x, q.z)) && far(c.x, c.z, 4)) {
        out.push({ kind: 'domino', x: c.x, z: c.z, yaw, building: bi, axis: { ux: f.rx, uz: f.rz, nx: f.nx, nz: f.nz } });
        taken.push(c);
      }
    } else if (doors.length && r < 0.42) {
      const d = doors[rng.int(0, doors.length - 1)];
      const kind = r < 0.19 ? 'fumar' : r < 0.29 ? 'celular' : 'barrer';
      if (kind === 'barrer') {
        const u0 = Math.max(0.6, d.u0 - 1.5);
        const u1 = Math.min(f.len - 0.6, d.u1 + 1.5);
        const a = facadePoint(f, u0, 0.95);
        const c = facadePoint(f, u1, 0.95);
        const m = facadePoint(f, (u0 + u1) / 2, 0.95);
        if (u1 - u0 > 1.5 && isFree(a.x, a.z) && isFree(c.x, c.z) && isFree(m.x, m.z) && far(m.x, m.z, 5)) {
          out.push({ kind, x: m.x, z: m.z, yaw: yawFromDir(f.rx, f.rz), building: bi, walk: { x: a.x, z: a.z, x1: c.x, z1: c.z }, face: yaw });
          taken.push(m);
        }
      } else {
        // Recostado a la fachada al lado de la puerta.
        const side = d.u1 + 0.5 < f.len - 0.35 ? d.u1 + 0.45 : d.u0 - 0.45;
        const p = facadePoint(f, side, 0.34);
        const front = facadePoint(f, side, 0.9);
        if (side > 0.35 && isFree(front.x, front.z) && isFree(p.x, p.z) && far(p.x, p.z, 5)) {
          out.push({ kind, x: p.x, z: p.z, yaw: yaw + rng.range(-0.35, 0.35), building: bi, lean: true });
          taken.push(p);
        }
      }
    }
  }

  // Motos parqueadas: el dueño la lava con un balde (una de cada cuatro).
  const pv = city.parkedVehicles ?? [];
  for (let i = 0; i < pv.length; i++) {
    const v = pv[i];
    if (v.type !== 'moto' || ((i * 2654435761) >>> 0) % 4 !== 0) continue;
    if (!far(v.x, v.z, 4)) continue;
    out.push({ kind: 'lavar', x: v.x, z: v.z, yaw: v.heading, vehicle: i });
    taken.push({ x: v.x, z: v.z });
  }

  // Canchas (y placas polideportivas): el picadito.
  for (const p of city.props ?? []) {
    if (p.type !== 'fieldPoly' || !p.frame) continue;
    out.push({ kind: 'futbol', ...fieldMatch(p.frame, p.placa ? 'arquitos' : 'porteria') });
  }
  // Calles residenciales tranquilas: partido con piedras de arco.
  let k = 0;
  for (const e of edges) {
    if (e.cls !== 'residential' || e.active === false || e.oneway || (e.width ?? 7) > 8.5 || !e.pts) continue;
    for (let i = 0; i + 1 < e.pts.length; i++) {
      const [ax, az] = e.pts[i];
      const [bx, bz] = e.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 34) continue;
      if (((e.id * 7 + i) * 2654435761) % 1000 >= 45) continue; // ~4.5 % de los tramos largos
      const ux = (bx - ax) / len;
      const uz = (bz - az) / len;
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      if (!far(cx, cz, 25)) continue;
      out.push({ kind: 'futbol', x: cx, z: cz, yaw: 0, street: true, id: k++, frame: { x: cx, z: cz, ux, uz, nx: -uz, nz: ux, hu: Math.min(13, len / 2 - 5), hv: (e.width ?? 7) / 2 - 0.35 }, goals: 'piedras', goalW: 0.9, players: 6 });
      taken.push({ x: cx, z: cz });
    }
  }
  return out;
}

/**
 * Partido en una cancha: eje largo del campo, medio ancho y alto de los arcos
 * y cuántos juegan (en las canchas grandes, cinco contra cinco).
 */
export function fieldMatch(fr, goals) {
  const along = fr.hu >= fr.hv;
  const frame = {
    x: fr.x,
    z: fr.z,
    ux: along ? fr.ux : fr.nx,
    uz: along ? fr.uz : fr.nz,
    nx: along ? fr.nx : fr.ux,
    nz: along ? fr.nz : fr.uz,
    hu: (along ? fr.hu : fr.hv) - (goals === 'porteria' ? 1.5 : 0.8),
    hv: (along ? fr.hv : fr.hu) - 0.6,
  };
  const big = frame.hu > 20;
  return { x: fr.x, z: fr.z, yaw: 0, frame, goals, goalW: goals === 'porteria' ? 2.4 : 1.4, goalH: goals === 'porteria' ? 2.1 : 1.9, players: big ? 10 : 8 };
}

/**
 * Lugares a menos de `r` m del punto, del más cercano al más lejano, que
 * quepan en el presupuesto de personas (`budget`, ver ACTIVITY_COST) sin
 * pasarse de `maxMatches` partidos. `active`: conjunto de lugares ya en
 * escena (cuentan en el presupuesto y no se repiten).
 */
export function pickNearSpots(spots, x, z, r, budget, { active = new Set(), maxMatches = 1, costOf = (s) => ACTIVITY_COST[s.kind] ?? 1 } = {}) {
  let used = 0;
  let matches = 0;
  for (const s of active) {
    used += costOf(s);
    if (s.kind === 'futbol') matches++;
  }
  const cand = [];
  for (const s of spots) {
    if (active.has(s)) continue;
    const d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d2 < r * r) cand.push([d2, s]);
  }
  cand.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [, s] of cand) {
    const c = costOf(s);
    if (used + c > budget) continue;
    if (s.kind === 'futbol' && matches >= maxMatches) continue;
    used += c;
    if (s.kind === 'futbol') matches++;
    out.push(s);
  }
  return out;
}

// ------------------------------------------------------------------ balón
export const BALL = { r: 0.11, g: 9.8, bounce: 0.55, roll: 0.45, rollDecel: 0.35, drag: 0.08, wall: 0.4 };

export function createBall(u = 0, v = 0) {
  return { u, v, y: BALL.r, vu: 0, vv: 0, vy: 0, holder: -1, spin: 0 };
}

/**
 * Integra el balón `dt` s en el marco del campo (u a lo largo, v a lo ancho):
 * gravedad, rebote contra el piso, rozamiento al rodar y rebote en los bordes
 * (±hu, ±hv) salvo por la boca de los arcos (|v| < goalW, y < goalH), por
 * donde puede entrar hasta `depth` m. Devuelve 'gol+' / 'gol-' al cruzar la
 * línea de un arco o null.
 */
export function stepBall(b, dt, { hu, hv, goalW = 0, goalH = 2, depth = 1 }) {
  if (b.holder >= 0) return null;
  const R = BALL.r;
  b.vy -= BALL.g * dt;
  b.u += b.vu * dt;
  b.v += b.vv * dt;
  b.y += b.vy * dt;
  const airK = Math.exp(-BALL.drag * dt);
  b.vu *= airK;
  b.vv *= airK;
  if (b.y <= R) {
    b.y = R;
    if (b.vy < -1.2) b.vy = -b.vy * BALL.bounce;
    else b.vy = 0;
  }
  if (b.y <= R + 1e-3 && b.vy === 0) {
    // Rodando: rozamiento proporcional y una desaceleración fija.
    const sp = Math.hypot(b.vu, b.vv);
    if (sp > 0) {
      const ns = Math.max(0, sp * Math.exp(-BALL.roll * dt) - BALL.rollDecel * dt);
      b.vu *= ns / sp;
      b.vv *= ns / sp;
    }
  }
  b.spin += Math.hypot(b.vu, b.vv) * dt / R;
  let goal = null;
  if (Math.abs(b.u) > hu) {
    const s = Math.sign(b.u);
    const mouth = goalW > 0 && Math.abs(b.v) < goalW && b.y < goalH;
    if (mouth) {
      if (!b.inGoal) goal = s > 0 ? 'gol+' : 'gol-';
      b.inGoal = true;
      // Red: el balón se frena al fondo del arco.
      if (Math.abs(b.u) > hu + depth) {
        b.u = s * (hu + depth);
        b.vu = -b.vu * 0.15;
      }
      if (Math.abs(b.v) > goalW - R) {
        b.v = Math.sign(b.v) * (goalW - R);
        b.vv = -b.vv * 0.2;
      }
    } else if (!b.inGoal) {
      b.u = s * hu;
      b.vu = -b.vu * BALL.wall;
    }
  } else b.inGoal = false;
  if (Math.abs(b.v) > hv && !b.inGoal) {
    b.v = Math.sign(b.v) * hv;
    b.vv = -b.vv * BALL.wall;
  }
  return goal;
}

/**
 * Patada: el balón sale del punto donde está hacia (tu, tv) a `power` m/s,
 * con `loft` m/s hacia arriba.
 */
export function kickBall(b, tu, tv, power, loft = 0) {
  const du = tu - b.u;
  const dv = tv - b.v;
  const d = Math.hypot(du, dv) || 1;
  b.holder = -1;
  b.vu = (du / d) * power;
  b.vv = (dv / d) * power;
  b.vy = loft;
  b.y = Math.max(b.y, BALL.r + 0.01);
}

/**
 * Distancia que rueda un balón lanzado a `v0` m/s (desaceleración
 * roll·v + rollDecel, sin contar el aire).
 */
export function rollDistance(v0) {
  const k = BALL.roll;
  const c = BALL.rollDecel;
  return v0 / k - (c / (k * k)) * Math.log(1 + (k * v0) / c);
}

/** Velocidad para que un pase rasante llegue a `d` m (y un poco más: que llegue con fuerza). */
export function passPower(d) {
  let lo = 0;
  let hi = 30;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid) < d * 1.25) lo = mid;
    else hi = mid;
  }
  return clamp(hi, 3, 15);
}

// ------------------------------------------------------------------ partido
export const MATCH = {
  run: 4.3, // m/s del que va por el balón
  jog: 2.6,
  walk: 1.2,
  accel: 7,
  reach: 0.55, // distancia para tocar el balón
  kickTime: 0.5, // duración de la patada (contacto a los 0.22 s)
  contact: 0.22,
  keeperHold: 1.3,
  goalPause: 3.2,
};

/**
 * Partido nuevo en un campo {hu, hv, goalW, goalH}: `n` jugadores en dos
 * equipos (el 0 ataca hacia +u); con arcos de verdad el primero de cada
 * equipo tapa.
 */
export function createMatch(field, n, rand = Math.random) {
  const m = { ...field, players: [], ball: createBall(0, 0), state: 'play', timer: 0, score: [0, 0], paused: false, lastTouch: -1, t: 0 };
  const keepers = field.goalW > 1 && n >= 6;
  const perTeam = Math.ceil(n / 2);
  for (let i = 0; i < n; i++) {
    const team = i % 2;
    const idx = Math.floor(i / 2);
    const keeper = keepers && idx === 0;
    const s = team === 0 ? -1 : 1; // lado propio
    const lane = perTeam > 1 ? (idx - (keepers ? 1 : 0)) / Math.max(1, perTeam - (keepers ? 2 : 1)) : 0.5;
    const home = keeper
      ? { u: s * (field.hu - 0.7), v: 0 }
      : { u: s * field.hu * (0.2 + 0.35 * ((idx + team) % 2)), v: (lane - 0.5) * field.hv * 1.3 };
    m.players.push({ i, team, keeper, home, u: home.u + (rand() - 0.5) * 2, v: home.v + (rand() - 0.5) * 2, vu: 0, vv: 0, speed: 0, yaw: team === 0 ? Math.PI / 2 : -Math.PI / 2, state: 'play', t: 0, cd: rand(), pace: 0.85 + rand() * 0.3, kick: null });
  }
  return m;
}

/** Yaw en el marco del campo de una dirección (du, dv). */
export function fieldYaw(du, dv) {
  // En el marco del campo u hace de "x" y v de "z": misma convención que el mundo.
  return yawFromDir(du, dv);
}

/** Índice del jugador de campo de `team` más cercano al balón (o -1). */
export function chaserOf(m, team) {
  let best = -1;
  let bd = Infinity;
  for (const p of m.players) {
    if (p.team !== team || p.keeper || p.state === 'out') continue;
    const d = (p.u - m.ball.u) ** 2 + (p.v - m.ball.v) ** 2;
    if (d < bd) {
      bd = d;
      best = p.i;
    }
  }
  return best;
}

/**
 * A quién o a dónde patea `p`: remate al arco si está cerca, si no, pase a
 * un compañero (mejor si está más adelante). Devuelve {tu, tv, power, loft, shot}.
 */
export function chooseKick(m, p, rand = Math.random) {
  const att = p.team === 0 ? 1 : -1; // hacia dónde ataca
  const goalU = att * m.hu;
  const toGoal = Math.abs(goalU - p.u);
  if (m.goalW > 0 && toGoal < (m.goals === 'porteria' ? 16 : 9) && rand() < 0.6) {
    const tv = (rand() * 2 - 1) * m.goalW * 1.2;
    return { tu: goalU + att, tv, power: 10 + rand() * 5, loft: rand() < 0.5 ? 0.5 + rand() * 2.5 : 0, shot: true };
  }
  const mates = m.players.filter((q) => q.team === p.team && q.i !== p.i && q.state !== 'out');
  if (!mates.length) return { tu: goalU, tv: 0, power: 6, loft: 0, shot: false };
  const w = mates.map((q) => 1 + Math.max(0, (q.u - p.u) * att) * 0.15 + (q.keeper ? -0.7 : 0));
  let r = rand() * w.reduce((a, b) => a + b, 0);
  let q = mates[mates.length - 1];
  for (let k = 0; k < mates.length; k++) {
    r -= w[k];
    if (r <= 0) {
      q = mates[k];
      break;
    }
  }
  // Al pie, un poco adelante de hacia donde corre.
  const tu = q.u + q.vu * 0.5;
  const tv = q.v + q.vv * 0.5;
  const d = Math.hypot(tu - p.u, tv - p.v);
  const lob = d > 14 && rand() < 0.5;
  return { tu, tv, power: lob ? clamp(d * 0.55, 6, 14) : passPower(d), loft: lob ? 3 + rand() * 2 : rand() < 0.2 ? 0.8 : 0, shot: false, to: q.i };
}

/**
 * Un paso del partido. Mueve jugadores y balón y devuelve los eventos del
 * paso: {type: 'kick', i, power} | {type: 'goal', team} | {type: 'catch', i}.
 * `m.paused` (pasa un carro por la calle): todos al andén y el balón en la
 * mano de uno hasta que se despeje.
 */
export function stepMatch(m, dt, rand = Math.random) {
  const ev = [];
  const b = m.ball;
  m.t += dt;
  // ---- estado del partido
  if (m.state === 'goal') {
    m.timer -= dt;
    if (m.timer <= 0) {
      m.state = 'play';
      Object.assign(b, createBall(0, 0));
      for (const p of m.players) if (p.state === 'cheer') p.state = 'play';
    }
  }
  const holder = b.holder >= 0 ? m.players[b.holder] : null;
  if (m.paused) {
    // El más cercano recoge el balón y todos se hacen a un lado.
    if (!holder) {
      let best = null;
      let bd = Infinity;
      for (const p of m.players) {
        const d = Math.hypot(p.u - b.u, p.v - b.v);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best && bd < MATCH.reach * 1.5) {
        b.holder = best.i;
        best.state = 'hold';
        best.t = 0;
      }
    }
  }
  const chasers = m.state === 'play' && !m.paused && !holder ? [chaserOf(m, 0), chaserOf(m, 1)] : [];
  const pickup = m.paused && !holder ? m.players.reduce((a, p) => (Math.hypot(p.u - b.u, p.v - b.v) < Math.hypot(a.u - b.u, a.v - b.v) ? p : a), m.players[0]) : null;

  for (const p of m.players) {
    if (p.state === 'out') continue;
    p.cd -= dt;
    let tu = p.home.u;
    let tv = p.home.v;
    let want = MATCH.walk;
    let face = null; // mirar al balón
    if (p.state === 'kick') {
      p.t += dt;
      want = 0;
      if (p.kick && !p.kick.done && p.t >= MATCH.contact) {
        p.kick.done = true;
        const k = p.kick;
        // Si el balón se alejó mucho antes del contacto, la patada no llega.
        if (Math.hypot(b.u - p.u, b.v - p.v) < MATCH.reach * 1.8 && b.holder < 0) {
          kickBall(b, k.tu, k.tv, k.power, k.loft);
          m.lastTouch = p.i;
          ev.push({ type: 'kick', i: p.i, power: k.power, shot: k.shot });
        }
      }
      if (p.t >= MATCH.kickTime) {
        p.state = 'play';
        p.kick = null;
        p.cd = 0.5 + rand() * 0.4;
      }
    } else if (p.state === 'hold') {
      p.t += dt;
      want = m.paused ? MATCH.walk : 0;
      if (m.paused) {
        tu = p.u;
        tv = Math.sign(p.v || 1) * (m.hv + 1.3);
      }
      b.u = p.u;
      b.v = p.v;
      b.y = 1.0;
      b.vu = b.vv = b.vy = 0;
      // El arquero (o el que la recogió) saca con la mano o con el pie.
      if (!m.paused && p.t > MATCH.keeperHold) {
        b.holder = -1;
        b.y = 0.6;
        const k = chooseKick(m, p, rand);
        kickBall(b, k.tu, k.tv, k.shot ? 9 : Math.min(k.power + 1, 12), 2 + rand() * 2);
        p.state = 'play';
        p.cd = 0.8;
        ev.push({ type: 'kick', i: p.i, power: k.power, throw: true });
      }
    } else if (p.state === 'cheer') {
      want = 0;
    } else if (m.paused) {
      // Al andén más cercano (o hacia el balón para recogerlo).
      if (pickup === p) {
        tu = b.u;
        tv = b.v;
        want = MATCH.jog;
      } else {
        tu = p.u;
        tv = Math.sign(p.v || (p.i % 2 ? 1 : -1)) * (m.hv + 1.3);
        want = MATCH.jog;
      }
    } else if (m.state === 'goal') {
      want = MATCH.walk * 0.8;
      tu = p.home.u * 0.6;
      tv = p.home.v;
    } else if (p.keeper) {
      // Bajo el arco, siguiendo el balón; sale a cortar si llega cerca.
      const s = p.team === 0 ? -1 : 1;
      tu = s * (m.hu - 0.7);
      tv = clamp(b.v * 0.6, -m.goalW * 0.8, m.goalW * 0.8);
      want = MATCH.jog;
      face = true;
      const d = Math.hypot(b.u - p.u, b.v - p.v);
      if (d < 4.5 && Math.sign(b.u) === s && !holder) {
        tu = b.u;
        tv = b.v;
        want = MATCH.run;
      }
      if (d < MATCH.reach + 0.35 && b.y < 2 && !holder && p.cd <= 0) {
        b.holder = p.i;
        p.state = 'hold';
        p.t = 0;
        ev.push({ type: 'catch', i: p.i });
      }
    } else if (chasers.includes(p.i)) {
      // Va por el balón (hacia donde va a estar en un momento).
      tu = b.u + b.vu * 0.35;
      tv = b.v + b.vv * 0.35;
      want = MATCH.run * p.pace;
      const d = Math.hypot(b.u - p.u, b.v - p.v);
      if (d < MATCH.reach && b.y < 0.6 && p.cd <= 0) {
        // Control y patada: el balón casi se frena en el pie.
        b.vu *= 0.25;
        b.vv *= 0.25;
        p.state = 'kick';
        p.t = 0;
        p.kick = chooseKick(m, p, rand);
        p.yaw = fieldYaw(p.kick.tu - p.u, p.kick.tv - p.v);
        want = 0;
      }
    } else {
      // Sin balón: se acomoda según dónde está el juego.
      tu = clamp(p.home.u + b.u * 0.45, -m.hu + 1, m.hu - 1);
      tv = clamp(p.home.v + b.v * 0.25, -m.hv + 0.8, m.hv - 0.8);
      const d = Math.hypot(tu - p.u, tv - p.v);
      want = d > 6 ? MATCH.jog * p.pace : d > 1.2 ? MATCH.walk * 1.2 : 0;
      face = true;
    }
    // ---- mover
    const du = tu - p.u;
    const dv = tv - p.v;
    const d = Math.hypot(du, dv);
    if (d < 0.25) want = 0;
    const cur = Math.hypot(p.vu, p.vv);
    const tgt = Math.min(want, d * 2.5);
    const ns = cur + clamp(tgt - cur, -MATCH.accel * 1.5 * dt, MATCH.accel * dt);
    if (d > 1e-3 && ns > 1e-3) {
      // La dirección gira con suavidad (no hay giros instantáneos a toda velocidad).
      const hy = dampAngle(cur > 0.2 ? fieldYaw(p.vu, p.vv) : fieldYaw(du, dv), fieldYaw(du, dv), 9, dt);
      p.vu = -Math.sin(hy) * ns;
      p.vv = -Math.cos(hy) * ns;
    } else {
      p.vu = 0;
      p.vv = 0;
    }
    p.u += p.vu * dt;
    p.v += p.vv * dt;
    p.speed = Math.hypot(p.vu, p.vv);
    if (p.state !== 'kick') {
      if (p.speed > 0.4) p.yaw = dampAngle(p.yaw, fieldYaw(p.vu, p.vv), 10, dt);
      else if (face || p.state === 'play') p.yaw = dampAngle(p.yaw, fieldYaw(b.u - p.u, b.v - p.v), 4, dt);
    }
  }
  // Nadie se monta encima de nadie.
  const P = m.players;
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 1; j < P.length; j++) {
      const a = P[i];
      const c = P[j];
      const du = c.u - a.u;
      const dv = c.v - a.v;
      const d = Math.hypot(du, dv);
      if (d < 0.7 && d > 1e-4) {
        const push = (0.7 - d) / 2;
        a.u -= (du / d) * push;
        a.v -= (dv / d) * push;
        c.u += (du / d) * push;
        c.v += (dv / d) * push;
      }
    }
  }
  // ---- balón
  if (b.holder < 0) {
    const goal = stepBall(b, dt, { hu: m.hu, hv: m.hv, goalW: m.goalW, goalH: m.goalH ?? 2, depth: m.goals === 'piedras' ? 3 : 1 });
    if (goal && m.state === 'play' && !m.paused) {
      const team = goal === 'gol+' ? 0 : 1;
      m.score[team]++;
      m.state = 'goal';
      m.timer = MATCH.goalPause;
      for (const p of m.players) if (p.team === team && p.state === 'play') p.state = 'cheer';
      ev.push({ type: 'goal', team, i: m.lastTouch });
    }
    if (m.goals === 'piedras' && b.inGoal && Math.abs(b.u) > m.hu + 2.5) {
      b.vu = 0;
      b.vv = 0;
    }
  } else if (m.state === 'goal' && holder) b.holder = -1;
  return ev;
}

/**
 * Empujón del jugador (o de cualquiera que pase) al balón: si lo toca
 * corriendo, sale en esa dirección. Devuelve true si lo tocó.
 */
export function nudgeBall(b, u, v, vu, vv) {
  if (b.holder >= 0) return false;
  const d = Math.hypot(b.u - u, b.v - v);
  const sp = Math.hypot(vu, vv);
  if (d > 0.45 || sp < 0.5 || b.y > 0.5) return false;
  kickBall(b, b.u + vu, b.v + vv, Math.min(12, sp * 1.7 + 1), sp > 4 ? 1 : 0);
  return true;
}
