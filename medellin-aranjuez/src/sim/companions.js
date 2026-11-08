// Damas de compañía (lógica pura, sin three.js): de noche unas pocas mujeres
// adultas esperan en el andén de algunas esquinas de avenida y cerca de la
// rumba de la Calle 92. Si el jugador para un carro a su lado y la invita
// (E), se sube de copiloto; hay que llevarla a un lugar tranquilo (sin gente
// ni policía cerca, el carro quieto unos segundos) y ahí la pantalla se va a
// negro: todo pasa fuera de cámara, se cobra y el jugador recupera vida.
// Luego se baja, se despide y se va. Disparos, policía o un choque fuerte la
// asustan: se baja y se va sin cobrar. Aquí: puestos, hora, cupo por
// calidad, cuándo se le puede ofrecer, lugar tranquilo, estados de la cita,
// fundido, cobro y vida. La escena está en game/companions.js.

import { makeRng } from './rng.js';
import { pointInPoly } from './geom2d.js';
import { MAPA, onRoad, roadAt } from './terrain.js';

import { discotecasDe, pintaRumba } from './nightlife.js';

// ------------------------------------------------------------ constantes configurables
/** h: desde esta hora de la noche salen al andén. */
export const HORA_DESDE = 21;
/** h: hasta esta hora de la madrugada (después se van caminando). */
export const HORA_HASTA = 4;
/** $ que cobra por la compañía (se cobra durante el fundido a negro). */
export const PRECIO = 300;
/**
 * Vida que recupera el jugador. Se llena hasta VIDA_MAX y no se pasa: la barra
 * de vida, el guardado y el hospital trabajan sobre 100 (una bonificación por
 * encima pediría otra barra y un desgaste aparte).
 */
export const VIDA_CITA = 100;
/** Tope de vida del jugador (el mismo del hospital y los botiquines). */
export const VIDA_MAX = 100;
/** Cuántas puede haber a la vez en escena, por calidad (las demás no salen). */
export const TOPE_DAMAS = { baja: 2, media: 3, alta: 4, ultra: 4 };
/** Puestos en esquinas de avenida (en todo el mapa; solo salen los cercanos al jugador). */
export const PUESTOS_AVENIDA = 10;
/** Puestos cerca de las discotecas de la Calle 92. */
export const PUESTOS_RUMBA = 3;
/** m mínimos entre dos puestos de avenida. */
export const SEPARACION_AVENIDA = 120;
/** m de la esquina hacia la cuadra: espera sobre la avenida, no en el cruce. */
export const RETIRO_ESQUINA = 5;
/** m a lado y lado de la puerta de una discoteca (pasando la fila y los grupos). */
export const RETIRO_RUMBA = 9.5;
/** Clases de vía (OpenStreetMap) que cuentan como avenida (en Aranjuez las vías principales, como la 49, la 92 o la 94, son 'tertiary'). */
export const AVENIDAS = ['primary', 'secondary', 'tertiary'];
/** m/s: el carro tiene que estar casi quieto para invitarla. */
export const OFRECER_VEL = 1.2;
/** m: distancia máxima entre el costado del copiloto y ella. */
export const OFRECER_LADO = 3.2;
/** m de margen hacia delante y hacia atrás del carro. */
export const OFRECER_LARGO = 1.2;
/** m: lugar tranquilo = ningún peatón vivo a menos de esto. */
export const TRANQUILO_PEATONES = 16;
/** m: … ni policía (agentes o patrullas) a menos de esto. */
export const TRANQUILO_POLICIA = 70;
/** m/s: el carro detenido. */
export const TRANQUILO_VEL = 0.5;
/** s detenido en el lugar tranquilo antes del fundido. */
export const TRANQUILO_TIEMPO = 3;
/** s del fundido completo (entra, negro, sale); el cobro va en la mitad. */
export const CITA_DURACION = 5;
/** s de entrada y de salida del negro. */
export const CITA_FUNDIDO = 0.9;
/** m: un disparo (de cualquiera) a menos de esto la asusta. */
export const SUSTO_DISPARO = 45;
/** m/s de impacto: un choque más fuerte que esto la asusta (el sonido del golpe arranca en 3). */
export const SUSTO_CHOQUE = 8;
/** Nivel de búsqueda desde el que se baja (la policía persiguiendo). */
export const SUSTO_BUSCADO = 1;
/** m/s: asustada, espera a que el carro baje de esto para bajarse. */
export const BAJAR_VEL = 2;
/** s antes de que vuelva a salir alguien en un puesto ya usado (o del que huyó). */
export const REAPARECER = 180;

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const yawOf = (x, z) => Math.atan2(x, z);
// Ni frente a colegios, iglesias, la estación de policía o el hospital.
const LEJOS_DE = new Set(['iglesia', 'hospital', 'policia', 'cayetano', 'claret', 'agustiniano', 'biblioteca', 'comfama', 'madreLaura', 'saludMoravia', 'ninodios', 'sanesteban', 'parque']);
const LEJOS_POI = 55;

// ------------------------------------------------------------ hora y cupo
/** ¿A esta hora (0-24) hay damas en el andén? */
export function esDeNoche(h, desde = HORA_DESDE, hasta = HORA_HASTA) {
  const x = ((h % 24) + 24) % 24;
  return desde > hasta ? x >= desde || x < hasta : x >= desde && x < hasta;
}

/** Cuántas a la vez según la calidad (el preset de render/postfx.js: label o peds). */
export function topeDamas(quality = {}) {
  const k = String(quality.label ?? '').toLowerCase();
  if (k in TOPE_DAMAS) return TOPE_DAMAS[k];
  const peds = quality.peds ?? 34;
  return peds >= 44 ? TOPE_DAMAS.alta : peds >= 34 ? TOPE_DAMAS.media : TOPE_DAMAS.baja;
}

// ------------------------------------------------------------ puestos
// Clase de la vía: la del tramo de la ciudad (la del mapa crudo puede ser otra).
function claseDe(city) {
  const byPts = new Map((city.edges ?? []).map((e) => [e.pts, e.cls]));
  return (x, z) => {
    const r = roadAt(x, z);
    const e = r && MAPA.edges[r.edge];
    return e ? (byPts.get(e.pts) ?? e.cls) : null;
  };
}

/** Reparte candidatos con al menos `gap` m entre sí y lejos de `taken`. */
function spread(cands, count, gap, taken = []) {
  const got = [];
  for (const c of cands) {
    if (got.length >= count) break;
    if (got.some((g) => dist(g, c) < gap) || taken.some((g) => dist(g, c) < 25)) continue;
    got.push(c);
  }
  return got;
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Puestos en el andén: sobre la avenida a RETIRO_ESQUINA m de una esquina, o
 * a lado y lado de una discoteca de la 92, cerca del borde de la acera y
 * mirando a la calle. `avoid`: puntos {x, z} que no se tocan (plazas de las
 * bandas, habitantes de calle). Cada uno: {id, tipo: 'avenida'|'rumba', x, z, yaw}.
 */
export function puestosDamas(city, { avoid = [], seed = 9292, avenida: nAv = PUESTOS_AVENIDA, rumba: nRu = PUESTOS_RUMBA, gap = SEPARACION_AVENIDA } = {}) {
  const rng = makeRng(seed);
  const blocked = (x, z) => city.collision?.pointBlocked?.(x, z) ?? false;
  const libre = (x, z) => !blocked(x, z) && !onRoad(x, z);
  const lejos = (city.pois ?? []).filter((p) => LEJOS_DE.has(p.id));
  const spawn = city.spawn ?? { x: 1e9, z: 1e9 };
  const clase = claseDe(city);
  const avenida = (x, z) => AVENIDAS.includes(clase(x, z));
  const ok = (c) => libre(c.x, c.z) && dist(c, spawn) > 50 && lejos.every((p) => dist(p, c) > LEJOS_POI);
  // Avenidas: cada tramo del andén que da a una avenida, cerca de sus dos
  // puntas (las esquinas de la cuadra). (Las esquinas "de libro" de
  // blockCorners casi nunca caen sobre una avenida: se toman los tramos.)
  const av = [];
  for (const b of city.blocks) {
    const r = b.ring;
    if (!r || !b.curb || r.length < 3) continue;
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i];
      const [bx, bz] = r[(i + 1) % r.length];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < RETIRO_ESQUINA * 2 + 2) continue;
      const u = [(bx - ax) / l, (bz - az) / l];
      // Normal hacia la calle (afuera de la manzana).
      let n = [u[1], -u[0]];
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (pointInPoly(mx + n[0] * 3, mz + n[1] * 3, b.curb)) n = [-n[0], -n[1]];
      if (!avenida(mx + n[0] * 3, mz + n[1] * 3)) continue;
      for (const [px, pz] of [[ax + u[0] * RETIRO_ESQUINA, az + u[1] * RETIRO_ESQUINA], [bx - u[0] * RETIRO_ESQUINA, bz - u[1] * RETIRO_ESQUINA]]) {
        if (!avenida(px + n[0] * 3, pz + n[1] * 3)) continue;
        // La línea de los peatones va a ~1 m del sardinel: se arrima un poco.
        const s = { tipo: 'avenida', x: px + n[0] * 0.35, z: pz + n[1] * 0.35, yaw: yawOf(n[0], n[1]) };
        if (ok(s)) av.push(s);
      }
    }
  }
  // La 92: a lado y lado de cada local, en la orilla del andén.
  const discos = discotecasDe(city);
  const rumba = [];
  for (const d of discos) {
    for (const u of [-RETIRO_RUMBA, RETIRO_RUMBA]) {
      const bx = d.fx + d.ux * u;
      const bz = d.fz + d.uz * u;
      let s = null;
      for (let k = 0.5; k < 6; k += 0.25) {
        if (onRoad(bx + d.nx * (k + 0.8), bz + d.nz * (k + 0.8))) {
          s = k;
          break;
        }
      }
      if (s == null) continue;
      const c = { tipo: 'rumba', x: bx + d.nx * s, z: bz + d.nz * s, yaw: yawOf(d.nx, d.nz) };
      // Sin meterse en la fila ni en los grupos de ningún local.
      if (ok(c) && discos.every((q) => Math.hypot(q.fx - c.x, q.fz - c.z) > 8.5)) rumba.push(c);
    }
  }
  const r = spread(shuffle(rumba, rng), nRu, 30, avoid);
  const a = spread(shuffle(av, rng), nAv, gap, [...avoid, ...r]);
  return [...r, ...a].map((p, i) => ({ id: `dama-${i + 1}`, ...p }));
}

/** Pinta de salir (prendas de rumba de sim/ropa.js, hidden): la de las rumberas. */
export function pintaDama(rng) {
  return pintaRumba(rng, true);
}

// ------------------------------------------------------------ invitarla
/** (dx, dz) del mundo al marco del vehículo (`heading`: giro del grupo; +z hacia delante). */
export function aMarco(dx, dz, heading) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

/**
 * ¿Se le puede ofrecer? Ella en (lx, lz) del marco del carro; `lado`: signo de
 * x del puesto del copiloto; `ancho`, `largo` del carro; `vel` en m/s. Tiene
 * que estar del lado del copiloto, a la altura del carro y con el carro quieto.
 */
export function puedeOfrecer({ lx, lz, ancho, largo, lado, vel }) {
  const fuera = lx * lado - ancho / 2;
  return Math.abs(vel) <= OFRECER_VEL && fuera > -0.2 && fuera <= OFRECER_LADO && Math.abs(lz) <= largo / 2 + OFRECER_LARGO;
}

/** ¿Le alcanza la plata? */
export function alcanza(dinero, precio = PRECIO) {
  return dinero >= precio;
}

/** Lo que queda después del cobro: {dinero, vida} (la vida se llena hasta VIDA_MAX, sin pasarse). */
export function cobrar({ dinero, vida }, precio = PRECIO, cura = VIDA_CITA, max = VIDA_MAX) {
  return { dinero: dinero - precio, vida: Math.max(vida, Math.min(max, vida + cura)) };
}

// ------------------------------------------------------------ lugar tranquilo y sustos
/** ctx: {peatones (vivos cerca), policia (bool), buscado (nivel)}. */
export function lugarTranquilo(ctx) {
  return (ctx.peatones ?? 0) === 0 && !ctx.policia && (ctx.buscado ?? 0) === 0;
}

/** Qué decirle al jugador en el aviso del HUD: 'policia' | 'gente' | 'para' | 'espera'. */
export function avisoLugar(ctx) {
  if (ctx.policia || (ctx.buscado ?? 0) > 0) return 'policia';
  if ((ctx.peatones ?? 0) > 0) return 'gente';
  if (Math.abs(ctx.vel ?? 0) >= TRANQUILO_VEL) return 'para';
  return 'espera';
}

/** Por qué se asusta (o null): {disparo (m al último, o null), buscado, choque (m/s)}. */
export function motivoSusto(ctx) {
  if (ctx.disparo != null && ctx.disparo < SUSTO_DISPARO) return 'disparos';
  if ((ctx.buscado ?? 0) >= SUSTO_BUSCADO) return 'policia';
  if ((ctx.choque ?? 0) >= SUSTO_CHOQUE) return 'choque';
  return null;
}

// ------------------------------------------------------------ la cita
/**
 * Estados: 'subiendo' (camina a la puerta y se sienta) → 'a_bordo' (buscando
 * lugar tranquilo) → 'cita' (fundido a negro) → 'bajando' (espera a que el
 * carro pare, si va rápido, y se baja) → 'se_va' | 'asustada'.
 */
export function nuevaCita() {
  return { estado: 'subiendo', t: 0, quieto: 0, cobrado: false, motivo: null, saliendo: false };
}

/**
 * Avanza la cita `dt` s. ctx: {sentada, abajo (terminó de bajarse), enCarro
 * (el jugador sigue manejando ese carro), muerto, vel, peatones, policia,
 * buscado, disparo, choque, plata (dinero del jugador)}. Devuelve el evento
 * del paso o null: 'a_bordo' | 'lugar' | 'cobro' | 'sin_plata' | 'fin' |
 * 'susto' | 'abandono' | 'salir' | 'abajo'.
 */
export function pasoCita(c, dt, ctx) {
  const viaje = c.estado === 'subiendo' || c.estado === 'a_bordo' || (c.estado === 'cita' && !c.cobrado);
  if (viaje || c.estado === 'cita') {
    // Un susto primero (si el jugador se tiró del carro por una balacera, ella huye).
    const susto = viaje ? motivoSusto(ctx) : null;
    if (susto) {
      c.susto = susto;
      return bajar(c, 'susto');
    }
    // El jugador se bajó (o murió): ella también, sin cobrar.
    if (!ctx.enCarro || ctx.muerto) return bajar(c, c.cobrado ? 'fin' : 'abandono');
  }
  switch (c.estado) {
    case 'subiendo':
      if (ctx.sentada) {
        c.estado = 'a_bordo';
        return 'a_bordo';
      }
      return null;
    case 'a_bordo':
      if (lugarTranquilo(ctx) && Math.abs(ctx.vel ?? 0) < TRANQUILO_VEL) c.quieto += dt;
      else c.quieto = 0;
      if (c.quieto >= TRANQUILO_TIEMPO) {
        c.estado = 'cita';
        c.t = 0;
        return 'lugar';
      }
      return null;
    case 'cita':
      c.t += dt;
      if (!c.cobrado && c.t >= CITA_DURACION / 2) {
        // (Si en el camino se gastó la plata, no hay cita: se baja.)
        if (ctx.plata != null && !alcanza(ctx.plata)) {
          bajar(c, 'sin_plata');
          return 'sin_plata';
        }
        c.cobrado = true;
        return 'cobro';
      }
      if (c.t >= CITA_DURACION) return bajar(c, 'fin');
      return null;
    case 'bajando':
      if (!c.saliendo) {
        // Asustada en marcha: espera a que el carro baje la velocidad (el jugador ya no maneja: de una).
        if (c.motivo !== 'susto' || !ctx.enCarro || Math.abs(ctx.vel ?? 0) < BAJAR_VEL) {
          c.saliendo = true;
          return 'salir';
        }
        return null;
      }
      if (ctx.abajo) {
        c.estado = c.motivo === 'susto' ? 'asustada' : 'se_va';
        return 'abajo';
      }
      return null;
    default:
      return null;
  }
}

function bajar(c, motivo) {
  const ev = motivo === 'susto' ? 'susto' : motivo === 'abandono' ? 'abandono' : 'fin';
  c.estado = 'bajando';
  c.motivo = motivo;
  c.saliendo = false;
  return ev;
}

/** Opacidad del velo negro durante la cita (0 … 1 … 0); 0 fuera de ella. */
export function fundidoCita(c, dur = CITA_DURACION, f = CITA_FUNDIDO) {
  if (c?.estado !== 'cita') return 0;
  const t = c.t;
  if (t < f) return t / f;
  if (t > dur - f) return Math.max(0, (dur - t) / f);
  return 1;
}
