// Matrices que no se recalculan en cada cuadro.
//
// three recalcula en cada dibujo (scene.updateMatrixWorld) la matriz local y la
// del mundo de TODOS los nodos de la escena, se muevan o no: la ciudad tiene
// ~10 000 nodos y casi ninguno se mueve (en Alta, con la oclusión ambiental,
// eran 58-69 mil llamadas por cuadro). Dos ayudas:
//  - freezeStatic: calcula una vez las matrices de un subárbol ya armado y la
//    raíz de cada parte 100 % estática deja de recorrerse. Lo dinámico (el
//    metro) y sus ancestros siguen como siempre.
//  - skipWhenHidden: vehículos y personajes lejanos (ocultos) no se recorren
//    mientras three prepara el dibujo; al volverse visibles se actualizan en
//    el siguiente.
// Ojo: en three 0.186 matrixWorldAutoUpdate=false NO evita el recorrido:
// updateMatrixWorld igual baja por todos los hijos (y con él, updateWorldMatrix
// ya no recalcula ese nodo: getWorldPosition daría un valor viejo). Por eso
// el recorrido se corta reemplazando updateMatrixWorld en la raíz del subárbol.

import * as THREE from 'three';

/** updateMatrixWorld de un subárbol congelado: sus matrices ya están calculadas. */
function frozenUpdate() {}

/**
 * Congela lo estático de `root` (ya armado y en su lugar). `dynamic(o)` marca
 * los nodos que sí se mueven: su subárbol entero queda vivo, igual que la
 * cadena de ancestros hasta `root`; todo lo demás se congela.
 * Devuelve el estado para checkStatic/thawStatic.
 */
export function freezeStatic(root, { dynamic = () => false } = {}) {
  root.updateWorldMatrix(true, true);
  const dyn = new Set();
  root.traverse((o) => {
    if (dynamic(o)) dyn.add(o);
  });
  // Vivos: los dinámicos y sus ancestros (hasta root).
  const live = new Set();
  for (const d of dyn) {
    for (let o = d; o && !live.has(o); o = o === root ? null : o.parent) live.add(o);
  }
  const st = { root, roots: [], nodes: [], auto: [], dynamic: [...dyn] };
  const freeze = (top) => {
    top.updateMatrixWorld = frozenUpdate;
    st.roots.push(top);
    top.traverse((o) => {
      st.nodes.push(o);
      st.auto.push(o.matrixAutoUpdate);
      o.matrixAutoUpdate = false;
      o.matrixWorldAutoUpdate = false;
    });
  };
  const visit = (o) => {
    if (dyn.has(o)) return; // se mueve: su subárbol queda como estaba
    if (!live.has(o)) return freeze(o);
    for (const c of o.children) visit(c);
  };
  visit(root);
  return st;
}

/** Deshace freezeStatic (pruebas y comparaciones A/B en la misma corrida). */
export function thawStatic(st) {
  for (const top of st.roots) delete top.updateMatrixWorld;
  st.nodes.forEach((o, i) => {
    o.matrixAutoUpdate = st.auto[i];
    o.matrixWorldAutoUpdate = true;
  });
  st.roots = [];
  st.nodes = [];
  st.auto = [];
  st.root.updateMatrixWorld(true);
}

const _m = new THREE.Matrix4();
const near = (a, b) => {
  const x = a.elements;
  const y = b.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(x[i] - y[i]) > 1e-5 * Math.max(1, Math.abs(x[i]))) return false;
  return true;
};
const pathOf = (o, root) => {
  const p = [];
  for (let x = o; x && x !== root; x = x.parent) p.push(x.name || x.type);
  return p.reverse().join('/');
};

/**
 * Revisión de lo congelado: nodos cuya posición/giro/escala (o matriz) ya no
 * corresponde a la matriz congelada, y nodos agregados después dentro de un
 * subárbol congelado (que nunca se actualizarían). Todo en 0 = bien.
 */
export function checkStatic(st) {
  let moved = 0;
  let added = 0;
  const sample = [];
  const note = (o, why) => {
    if (sample.length < 8) sample.push(`${why}: ${pathOf(o, st.root)}`);
  };
  st.nodes.forEach((o, i) => {
    if (st.auto[i] && !near(_m.compose(o.position, o.quaternion, o.scale), o.matrix)) {
      moved++;
      return note(o, 'movido');
    }
    if (o.parent && !near(_m.multiplyMatrices(o.parent.matrixWorld, o.matrix), o.matrixWorld)) {
      moved++;
      note(o, 'mundo');
    }
  });
  for (const top of st.roots) {
    top.traverse((o) => {
      if (o.matrixWorldAutoUpdate !== false) {
        added++;
        note(o, 'agregado');
      }
    });
  }
  return { roots: st.roots.length, nodes: st.nodes.length, dynamic: st.dynamic.length, moved, added, sample };
}

// ------------------------------------------------------------------ ocultos

let inScene = false; // dentro del updateMatrixWorld de una escena marcada

/**
 * La escena avisa cuándo three la está recorriendo para dibujar: solo ahí se
 * saltan los subárboles ocultos (una llamada explícita a updateMatrixWorld,
 * p. ej. para medir un asiento, sigue actualizando todo).
 */
export function sceneSkipsHidden(scene) {
  if (Object.prototype.hasOwnProperty.call(scene, 'updateMatrixWorld')) return scene;
  const base = scene.updateMatrixWorld;
  scene.updateMatrixWorld = function (force) {
    const prev = inScene;
    inScene = true;
    try {
      base.call(this, force);
    } finally {
      inScene = prev;
    }
  };
  return scene;
}

const SKIP = Symbol('saltarOculto');

/** Mientras `obj` esté oculto, el dibujo no recorre su subárbol (idempotente). */
export function skipWhenHidden(obj) {
  if (obj[SKIP]) return obj;
  obj[SKIP] = true;
  const base = obj.updateMatrixWorld; // el de su clase
  obj.updateMatrixWorld = function (force) {
    if (this.visible || !inScene) base.call(this, force);
  };
  return obj;
}
