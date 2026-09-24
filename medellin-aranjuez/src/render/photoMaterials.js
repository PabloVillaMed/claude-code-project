// Materiales PBR fotográficos (texturas CC0 de Poly Haven) para la ciudad y
// la iluminación ambiental HDRI. Si las texturas no están disponibles, el
// render usa las texturas procedurales de textures.js.

import * as THREE from 'three';
import { assets } from './assets.js';
import { registerAssets } from './assetManifest.js';

// Tamaño real (m) que cubre cada textura (de la API de Poly Haven) y si
// tiene color HD (2048 px, calidades Alta/Ultra). Ver scripts/assets/texturas.mjs.
export const PHOTO_TEXTURES = {
  red_brick: { m: 1.4, hd: true },
  large_red_bricks: { m: 2.0, hd: true },
  brick_wall_07: { m: 1.7, hd: true },
  painted_brick: { m: 1.8, hd: true },
  peeling_painted_wall: { m: 1.8, hd: true },
  painted_plaster_wall: { m: 2.0, hd: true },
  beige_wall_001: { m: 3.0, hd: true },
  asphalt_02: { m: 3.0, hd: true },
  grey_tiles: { m: 2.2, hd: true },
  herringbone_brick: { m: 1.8 },
  leafy_grass: { m: 2.0, hd: true },
  clay_roof_tiles_02: { m: 2.5 },
  concrete_floor_02: { m: 2.0 },
  concrete_wall_008: { m: 2.71 },
  corrugated_iron_02: { m: 2.7 },
  painted_metal_shutter: { m: 2.0 },
  dirty_tiles: { m: 2.26 },
  granite_tile: { m: 2.3 },
  rusty_painted_metal: { m: 2.2 },
};

registerAssets([
  ...Object.entries(PHOTO_TEXTURES).flatMap(([id, t]) => [
    { key: `tex/${id}/color`, type: 'texture', url: `textures/${id}/color.webp`, urlHd: t.hd ? `textures/${id}/hd/color.webp` : undefined, srgb: true },
    { key: `tex/${id}/normal`, type: 'texture', url: `textures/${id}/normal.webp`, srgb: false },
    { key: `tex/${id}/rough`, type: 'texture', url: `textures/${id}/rough.webp`, srgb: false },
  ]),
  { key: 'hdri/dia', type: 'hdr', url: 'hdri/kloofendal_48d_partly_cloudy_puresky.hdr', urlHd: 'hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr' },
]);

export function hasPhotoTextures() {
  return !!assets.texture('tex/red_brick/color');
}

/** Clona una textura (comparte la imagen en GPU) con la repetición dada. */
function withRepeat(tex, repeat) {
  if (!tex) return null;
  const t = tex.clone();
  t.repeat.set(repeat, repeat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/**
 * Material PBR fotográfico. `uvMeters` = cuántos metros abarca una unidad de
 * UV en la geometría (así la textura queda a su tamaño real).
 */
export function photoMaterial(id, { uvMeters = 1, vertexColors = false, color = 0xffffff, normalScale = 1, roughness = 1, extra = {} } = {}) {
  const base = assets.texture(`tex/${id}/color`);
  if (!base) return null;
  const repeat = uvMeters / (PHOTO_TEXTURES[id]?.m ?? 2);
  const m = new THREE.MeshStandardMaterial({
    map: withRepeat(base, repeat),
    normalMap: withRepeat(assets.texture(`tex/${id}/normal`), repeat),
    roughnessMap: withRepeat(assets.texture(`tex/${id}/rough`), repeat),
    roughness,
    metalness: 0,
    color,
    vertexColors,
    ...extra,
  });
  m.normalScale.set(normalScale, normalScale);
  return m;
}

/**
 * Fachada = material fotográfico (ladrillo o repello) + capa de ventanas,
 * marcos, rejas, persianas y suciedad (canvas) que se mezcla en el shader
 * sin teñirse con el color de la casa. La capa usa las UV sin repetir (las
 * mismas del mapa emisivo de ventanas encendidas).
 *  overlay: RGBA (alfa = dónde tapa la pared)
 *  mask: R = vidrio (brillante), G = metal/persiana
 */
export function facadeMaterial(id, facade, { uvMeters = 12, normalScale = 1.2 } = {}) {
  const m = photoMaterial(id, { uvMeters, vertexColors: true, normalScale });
  if (!m) return null;
  m.emissiveMap = facade.emissiveMap;
  m.emissive = new THREE.Color(0xffc27a);
  m.emissiveIntensity = 0;
  const overlay = facade.overlay;
  const mask = facade.mask;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.facadeOverlay = { value: overlay };
    shader.uniforms.facadeMask = { value: mask };
    shader.fragmentShader = `uniform sampler2D facadeOverlay;\nuniform sampler2D facadeMask;\n${shader.fragmentShader}`
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec4 fOv = texture2D( facadeOverlay, vEmissiveMapUv );
        vec4 fMask = texture2D( facadeMask, vEmissiveMapUv );
        diffuseColor.rgb = mix( diffuseColor.rgb, fOv.rgb, fOv.a );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, 0.06, fMask.r );
        roughnessFactor = mix( roughnessFactor, 0.55, fMask.g );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize( mix( normal, nonPerturbedNormal, fOv.a ) );`,
      );
  };
  m.customProgramCacheKey = () => 'fachada-foto';
  return m;
}

/** HDRI de día convertido a mapa de entorno prefiltrado (PMREM). */
export function dayEnvironment(pmrem) {
  const hdr = assets.get('hdri/dia');
  if (!hdr) return null;
  return pmrem.fromEquirectangular(hdr).texture;
}
