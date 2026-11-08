// Dibujo de la utilería que se tumba (sim/destructibles.js): postes de
// energía, faroles, placas de nomenclatura y árboles. Enlaza cada entrada del
// registro con lo que la dibuja y, cuando su pose cambia, reescribe SOLO lo
// suyo:
//  - instancias (render/props.js ChunkedInstances): los 16 números de su
//    matriz en el buffer de su trozo (rango de subida de esa instancia; ni
//    los demás trozos ni la escena congelada se tocan);
//  - placas (render/streetFurniture.js, fusionadas): sus ~70 vértices;
//  - cables: los tramos que llegan a un poste tumbado bajan con él;
//  - farol: el vidrio se apaga (color por instancia) y su luz también
//    (cabeza `off`: groundLights y nightLights la saltan).
// Sin asignaciones por cuadro: matrices y vectores de trabajo fijos; la copia
// de la pose original se guarda la primera vez que algo se tumba.

import * as THREE from 'three';
import { DE_PIE } from '../sim/destructibles.js';
import { GRID, terrainHeight } from '../sim/terrain.js';
import { instanceMatrix, setInstanceMatrix, setInstanceColor, instanceMeshes } from './props.js';

// ------------------------------------------------------------------ ajustes
/** Gris del vidrio de un farol tumbado: 0,5 = sin brillo (props.js apagable), 1 = encendido. */
export const VIDRIO_APAGADO = 0.5;
/** Comba (m) en el medio de un tramo de cable (la misma con que se tienden en props.js). */
export const COMBA_CABLE = 1.1;
/** Altura mínima (m) de un cable sobre el piso cuando su poste quedó tumbado. */
export const CABLE_SOBRE_PISO = 0.06;
/** Margen (m) que crece la esfera de recorte del trozo de algo tumbado (que no desaparezca al salirse de ella). */
export const MARGEN_ESFERA = 3;

const groundY = (x, z) => terrainHeight(x, z) + GRID.curb;

const _up = new THREE.Vector3(0, 1, 0);
const _ax = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _P = new THREE.Matrix4();
const _Pb = new THREE.Matrix4();
const _M0 = new THREE.Matrix4();
const _M = new THREE.Matrix4();
const _sph = new THREE.Sphere();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Pose de una entrada que cae, como matriz (en `out`): inclinada `e.ang`
 * hacia (dirX, dirZ) sobre su base (bx, by, bz), torcida `e.giro` sobre su
 * eje, y con la base corrida `desliz` m (y `dy` en altura).
 */
export function fallMatrix(e, bx, by, bz, out) {
  _qy.setFromAxisAngle(_up, e.giro);
  // Eje = arriba × dirección: el tope del objeto gira hacia (dirX, dirZ).
  _q.setFromAxisAngle(_ax.set(e.dirZ, 0, -e.dirX), e.ang).multiply(_qy);
  out.makeRotationFromQuaternion(_q);
  const m = out.elements;
  // T(base + corrido) · R · T(−base)
  m[12] = bx + e.dirX * e.desliz - (m[0] * bx + m[4] * by + m[8] * bz);
  m[13] = by + e.dy - (m[1] * bx + m[5] * by + m[9] * bz);
  m[14] = bz + e.dirZ * e.desliz - (m[2] * bx + m[6] * by + m[10] * bz);
  return out;
}

export class DestructiblesView {
  /** r: el CityRenderer (propInstances, propLights, poleCables, cableLines, signParts); sim: Destructibles. */
  constructor(r, sim) {
    this.sim = sim;
    this.cables = r.cableLines?.geometry.attributes.position ?? null;
    this.rootY = r.root?.position.y ?? 0;
    let n = 0;
    for (const e of sim.entries) {
      const h = r.propInstances?.get(e.prop) ?? null;
      const sign = h ? null : r.signParts?.get(e.prop) ?? null;
      if (!h && !sign) continue;
      const cables = this.cables ? r.poleCables?.get(e.prop) ?? null : null;
      sim.enlazar(e, { h, sign, head: r.propLights?.get(e.prop) ?? null, cables, m0: null, bl: null, bw: null, p0: null, n0: null, off: false }, h?.h ?? 0);
      // Cada tramo sabe qué entrada tiene en cada punta (si se tumba, baja).
      for (const t of cables ?? []) {
        if (t.a === e.prop) t.ea = e;
        else t.eb = e;
      }
      n++;
    }
    this.enlazados = n;
    // Lo que no tiene dibujo propio (árboles procedurales, calidad sin modelos) no se tumba.
    this.firmes = sim.fijarSinDibujo();
  }

  /** Reescribe lo que cambió en este paso del registro (normalmente nada). */
  update() {
    const s = this.sim;
    for (let j = 0; j < s.nCambiados; j++) this._pose(s.cambiados[j]);
    s.limpiarCambios();
  }

  _pose(e) {
    const inst = e.inst;
    if (!inst) return;
    const dePie = e.estado === DE_PIE;
    if (!inst.bw) this._preparar(e, inst);
    if (inst.h) {
      if (dePie) setInstanceMatrix(inst.h, inst.m0);
      else {
        fallMatrix(e, inst.bl[0], inst.bl[1], inst.bl[2], _P);
        setInstanceMatrix(inst.h, _M.multiplyMatrices(_P, _M0.fromArray(inst.m0)).elements);
      }
    } else if (inst.sign) this._placa(e, inst, dePie);
    // Farol: se apaga al tumbarse y se prende al reponerse.
    if (inst.head && inst.off === dePie) {
      inst.off = !dePie;
      inst.head.off = !dePie;
      const c = dePie ? 1 : VIDRIO_APAGADO;
      if (inst.h) setInstanceColor(inst.h, c, c, c);
    }
    if (inst.cables) for (const t of inst.cables) this._tramo(t);
  }

  /** La primera vez que se mueve: copia de su pose original, base y esfera de recorte. */
  _preparar(e, inst) {
    if (inst.h) {
      inst.m0 = instanceMatrix(inst.h, new Float32Array(16));
      // Matrices relativas al centro del trozo: la base es la traslación.
      inst.bl = [inst.m0[12], inst.m0[13], inst.m0[14]];
      inst.bw = [e.prop.x, inst.bl[1] + inst.h.group.position.y + this.rootY, e.prop.z];
      _sph.center.set(inst.bl[0], inst.bl[1], inst.bl[2]);
      _sph.radius = e.h + MARGEN_ESFERA;
      for (const im of instanceMeshes(inst.h)) {
        if (!im.boundingSphere) im.computeBoundingSphere();
        im.boundingSphere.union(_sph);
      }
      return;
    }
    // Placa fusionada: copia de sus vértices; la base es el pie del tubo.
    inst.p0 = [];
    inst.n0 = [];
    let y0 = Infinity;
    for (const r of inst.sign) {
      const pos = r.mesh.geometry.attributes.position.array;
      inst.p0.push(pos.slice(r.start * 3, (r.start + r.count) * 3));
      inst.n0.push(r.mesh.geometry.attributes.normal.array.slice(r.start * 3, (r.start + r.count) * 3));
    }
    const p = inst.p0[0];
    for (let k = 1; k < p.length; k += 3) y0 = Math.min(y0, p[k]);
    inst.bw = [e.prop.x, Number.isFinite(y0) ? y0 : groundY(e.prop.x, e.prop.z), e.prop.z];
  }

  /** Vértices de una placa fusionada: de pie (copia original) o en su pose de caída. */
  _placa(e, inst, dePie) {
    if (!dePie) fallMatrix(e, inst.bw[0], inst.bw[1], inst.bw[2], _P);
    const m = _P.elements;
    for (let k = 0; k < inst.sign.length; k++) {
      const r = inst.sign[k];
      const pos = r.mesh.geometry.attributes.position;
      const nor = r.mesh.geometry.attributes.normal;
      const p0 = inst.p0[k];
      const n0 = inst.n0[k];
      const o = r.start * 3;
      if (dePie) {
        pos.array.set(p0, o);
        nor.array.set(n0, o);
      } else {
        const P = pos.array;
        const N = nor.array;
        for (let i = 0; i < p0.length; i += 3) {
          const x = p0[i];
          const y = p0[i + 1];
          const z = p0[i + 2];
          P[o + i] = m[0] * x + m[4] * y + m[8] * z + m[12];
          P[o + i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          P[o + i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          const nx = n0[i];
          const ny = n0[i + 1];
          const nz = n0[i + 2];
          N[o + i] = m[0] * nx + m[4] * ny + m[8] * nz;
          N[o + i + 1] = m[1] * nx + m[5] * ny + m[9] * nz;
          N[o + i + 2] = m[2] * nx + m[6] * ny + m[10] * nz;
        }
      }
      pos.addUpdateRange(o, p0.length);
      pos.needsUpdate = true;
      nor.addUpdateRange(o, n0.length);
      nor.needsUpdate = true;
    }
  }

  /**
   * Vuelve a tender un tramo de cable entre sus dos postes (de pie o
   * tumbados): misma catenaria con que se armó (props.js buildPoles), sin
   * bajar del piso.
   */
  _tramo(t) {
    const arr = this.cables.array;
    t.ya ??= groundY(t.a.x, t.a.z);
    t.yb ??= groundY(t.b.x, t.b.z);
    const pa = t.ea && t.ea.estado !== DE_PIE && t.ea.inst.bw ? fallMatrix(t.ea, t.ea.inst.bw[0], t.ea.inst.bw[1], t.ea.inst.bw[2], _P) : null;
    const pb = t.eb && t.eb.estado !== DE_PIE && t.eb.inst.bw ? fallMatrix(t.eb, t.eb.inst.bw[0], t.eb.inst.bw[1], t.eb.inst.bw[2], _Pb) : null;
    const n = t.n;
    let o = t.start * 3;
    for (let j = 0; j < t.A.length; j++) {
      _a.set(t.a.x + t.A[j][0], t.ya + t.A[j][1], t.a.z);
      _b.set(t.b.x + t.B[j][0], t.yb + t.B[j][1], t.b.z);
      if (pa) _a.applyMatrix4(pa);
      if (pb) _b.applyMatrix4(pb);
      for (let s = 0; s < n; s++) {
        for (let w = 0; w < 2; w++) {
          const u = (s + w) / n;
          const piso = t.ya + (t.yb - t.ya) * u + CABLE_SOBRE_PISO;
          arr[o] = _a.x + (_b.x - _a.x) * u;
          arr[o + 1] = Math.max(piso, _a.y + (_b.y - _a.y) * u - COMBA_CABLE * 4 * u * (1 - u));
          arr[o + 2] = _a.z + (_b.z - _a.z) * u;
          o += 3;
        }
      }
    }
    this.cables.addUpdateRange(t.start * 3, o - t.start * 3);
    this.cables.needsUpdate = true;
  }
}
