// Materiales PBR fotográficos (texturas CC0 de Poly Haven) para la ciudad y
// la iluminación ambiental HDRI. Si las texturas no están disponibles, el
// render usa las texturas procedurales de textures.js.

import * as THREE from 'three';
import { assets } from './assets.js';
import { registerAssets } from './assetManifest.js';

// Tamaño real (m) que cubre cada textura (de la API de Poly Haven).
export const PHOTO_TEXTURES = {
  red_brick: 1.4,
  large_red_bricks: 2.0,
  painted_plaster_wall: 2.0,
  beige_wall_001: 3.0,
  asphalt_02: 3.0,
  grey_tiles: 2.2,
  herringbone_brick: 1.8,
  leafy_grass: 2.0,
  clay_roof_tiles_02: 2.5,
  concrete_floor_02: 2.0,
  concrete_wall_008: 2.71,
  corrugated_iron_02: 2.7,
};

registerAssets([
  ...Object.keys(PHOTO_TEXTURES).flatMap((id) => [
    { key: `tex/${id}/color`, type: 'texture', url: `textures/${id}/color.webp`, srgb: true },
    { key: `tex/${id}/normal`, type: 'texture', url: `textures/${id}/normal.webp`, srgb: false },
    { key: `tex/${id}/rough`, type: 'texture', url: `textures/${id}/rough.webp`, srgb: false },
  ]),
  { key: 'hdri/dia', type: 'hdr', url: 'hdri/kloofendal_48d_partly_cloudy_puresky.hdr' },
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
  const repeat = uvMeters / (PHOTO_TEXTURES[id] ?? 2);
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
