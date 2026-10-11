// Gestor de recursos externos (modelos glTF, texturas y HDRI). Cada módulo de
// render declara su manifiesto; Game los carga todos al arrancar con barra de
// progreso. Si un archivo falta o falla, se registra y el módulo usa su
// versión procedural (el juego nunca se rompe por un asset).
//
// Los archivos viven en public/ (Vite los copia tal cual a dist/). Las rutas
// son relativas a index.html para funcionar en web y en Electron (app://).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Entrada de manifiesto:
 *  { key: 'personajes/male01', type: 'gltf' | 'texture' | 'hdr', url: 'models/x.glb',
 *    urlHd?: 'models/x-hd.glb', srgb?: boolean, repeat?: boolean, optional?: boolean,
 *    post?: (gltf) => gltf  (retoque del glTF recién cargado, p. ej. desempacar clips) }
 */
class AssetLibrary {
  constructor() {
    this.items = new Map();
    this.failed = new Map();
    this.manifest = new Map();
    this.renderer = null;
    this.hd = false; // usar `urlHd` (texturas de 2048 px) cuando la entrada la tenga
  }

  /** Declara recursos a cargar (se puede llamar desde cualquier módulo). */
  register(entries) {
    for (const e of entries) this.manifest.set(e.key, e);
  }

  has(key) {
    return this.items.has(key);
  }

  get(key) {
    return this.items.get(key) ?? null;
  }

  /** glTF cargado ({scene, animations, ...}) o null si no está disponible. */
  gltf(key) {
    return this.get(key);
  }

  texture(key) {
    return this.get(key);
  }

  _gltfLoader() {
    if (!this._gltf) {
      this._gltf = new GLTFLoader();
      this._gltf.setMeshoptDecoder(MeshoptDecoder);
    }
    return this._gltf;
  }

  async _loadOne(e) {
    if (this.hd && e.urlHd) {
      try {
        return await this._loadUrl(e, e.urlHd);
      } catch {
        // Sin la versión HD se usa la normal.
      }
    }
    return this._loadUrl(e, e.url);
  }

  async _loadUrl(e, url) {
    const anisotropy = this.renderer ? Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) : 4;
    switch (e.type) {
      case 'gltf': {
        const g = await this._gltfLoader().loadAsync(url);
        return e.post ? e.post(g) : g;
      }
      case 'hdr': {
        const t = await new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(url);
        t.mapping = THREE.EquirectangularReflectionMapping;
        return t;
      }
      case 'texture': {
        const t = await new THREE.TextureLoader().loadAsync(url);
        t.colorSpace = e.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        if (e.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = anisotropy;
        return t;
      }
      default:
        throw new Error(`Tipo de asset desconocido: ${e.type}`);
    }
  }

  /** Carga todo lo registrado que aún no esté cargado. */
  async loadAll(renderer, onProgress = () => {}) {
    this.renderer = renderer;
    const pending = [...this.manifest.values()].filter((e) => !this.items.has(e.key) && !this.failed.has(e.key));
    let done = 0;
    const total = pending.length || 1;
    const queue = [...pending];
    const worker = async () => {
      while (queue.length) {
        const e = queue.shift();
        try {
          this.items.set(e.key, await this._loadOne(e));
        } catch (err) {
          this.failed.set(e.key, String(err?.message ?? err));
          if (!e.optional) console.warn(`[assets] No se pudo cargar ${e.key} (${e.url}): ${err?.message ?? err}`);
        }
        done++;
        onProgress(done / total, e.key);
      }
    };
    // Varias descargas en paralelo.
    await Promise.all(Array.from({ length: Math.min(6, pending.length) }, worker));
    return { loaded: this.items.size, failed: [...this.failed.keys()] };
  }
}

export const assets = new AssetLibrary();

/**
 * Crea un material PBR a partir de un juego de texturas registrado con el
 * prefijo dado: `${prefix}/color`, `/normal`, `/rough`, `/ao` (opcionales).
 * Devuelve null si no hay textura de color (para usar el respaldo procedural).
 */
export function pbrFromAssets(prefix, opts = {}) {
  const map = assets.texture(`${prefix}/color`);
  if (!map) return null;
  const normalMap = assets.texture(`${prefix}/normal`);
  const roughnessMap = assets.texture(`${prefix}/rough`);
  const aoMap = assets.texture(`${prefix}/ao`);
  const m = new THREE.MeshStandardMaterial({
    map,
    normalMap: normalMap ?? null,
    roughnessMap: roughnessMap ?? null,
    aoMap: aoMap ?? null,
    roughness: roughnessMap ? 1 : (opts.roughness ?? 0.85),
    metalness: opts.metalness ?? 0,
    ...opts.extra,
  });
  if (normalMap && opts.normalScale) m.normalScale.set(opts.normalScale, opts.normalScale);
  return m;
}
