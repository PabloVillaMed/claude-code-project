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
    // Lado máximo (px) de las imágenes de texturas y modelos al cargarlos
    // (quality.texMax; 0 = como vienen). En Baja (celulares) las de 1024 px
    // quedan de 512: la cuarta parte de memoria de video y de subida.
    this.texMax = 0;
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
    // Con el tope por debajo de 2048 px la versión HD se achicaría igual.
    if (this.hd && e.urlHd && (this.texMax || Infinity) >= 2048) {
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
        if (this.texMax) await shrinkSceneTextures(g.scene, this.texMax);
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
        if (this.texMax) await shrinkTexture(t, this.texMax);
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

// ------------------------------------------------------------------ texturas achicadas (texMax)

/**
 * ¿createImageBitmap respeta tamaño, orientación y alfa? Mismo criterio de
 * GLTFLoader; en Safari se usa el lienzo (las opciones no son confiables).
 */
function bitmapOptionsOk() {
  if (typeof createImageBitmap === 'undefined') return false;
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent ?? '') : '';
  const safari = /^((?!chrome|android).)*safari/i.test(ua);
  const firefox = +(ua.match(/Firefox\/(\d+)\./)?.[1] ?? 0);
  return !safari && !(firefox && firefox < 98);
}

/**
 * Copia de `img` reducida a w×h: ImageBitmap (se decodifica fuera del hilo
 * principal) o, si no hay soporte, un lienzo. `flip` voltea la imagen (un
 * ImageBitmap no se voltea al subirlo: three ignora flipY con ellos).
 */
async function resizedImage(img, w, h, flip) {
  if (bitmapOptionsOk()) {
    try {
      const opts = { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
      if (flip) opts.imageOrientation = 'flipY';
      const b = await createImageBitmap(img, opts);
      if (b.width === w && b.height === h) return { image: b, flipped: flip };
      b.close(); // ignoró el tamaño pedido
    } catch {
      // Opciones no soportadas: se usa el lienzo.
    }
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { image: c, flipped: false };
}

/**
 * Reduce la imagen de una textura (y de las que comparten su Source) para
 * que su lado mayor no pase de `max` px. Conserva colorSpace, envoltura,
 * filtros y la orientación (si la imagen nueva ya viene volteada, flipY pasa
 * a false). Si algo falla deja la textura como estaba.
 */
export async function shrinkTexture(t, max, shared = [t]) {
  const img = t?.image;
  if (!img || t.isDataTexture || t.isCompressedTexture || t.isCubeTexture || t.isVideoTexture) return t;
  const w = img.width ?? 0;
  const h = img.height ?? 0;
  if (!(max > 0) || !(Math.max(w, h) > max)) return t;
  const k = max / Math.max(w, h);
  const isBitmap = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;
  try {
    const r = await resizedImage(img, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), t.flipY && !isBitmap);
    t.image = r.image; // la Source es compartida: vale para todos los clones
    for (const s of shared) {
      if (r.flipped) s.flipY = false;
      s.needsUpdate = true;
    }
    if (isBitmap) img.close(); // libera la decodificada de tamaño completo
  } catch (err) {
    console.warn(`[assets] No se pudo reducir una textura: ${err?.message ?? err}`);
  }
  return t;
}

/** Reduce (una vez por imagen) las texturas de los materiales de un modelo. */
export async function shrinkSceneTextures(root, max) {
  const bySource = new Map();
  root?.traverse((o) => {
    for (const m of [].concat(o.material ?? [])) {
      for (const v of Object.values(m)) {
        if (!v?.isTexture || !v.image) continue;
        const list = bySource.get(v.source);
        if (list) {
          if (!list.includes(v)) list.push(v);
        } else bySource.set(v.source, [v]);
      }
    }
  });
  await Promise.all([...bySource.values()].map((list) => shrinkTexture(list[0], max, list)));
}

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
