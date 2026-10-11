// Material de los cables eléctricos y de teléfono: líneas de 1 px que se
// ven del grosor real de un cable (~1,5 cm). Se calcula cuántos píxeles
// ocuparía el cable a esa distancia y, si es menos de uno, la línea se vuelve
// transparente en esa proporción: de cerca se ve negra y nítida, de lejos
// queda como un trazo fino y tenue en vez de una cuerda gruesa.

import * as THREE from 'three';

const WIRE_RADIUS = 0.0075; // m (cable de ~1,5 cm)

export function wireMaterial(color = 0x1c1c1c) {
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, depthWrite: false });
  const pxScale = { value: 360 }; // mitad de la altura del búfer (px), se actualiza al dibujar
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPxScale = pxScale;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'uniform float uPxScale;\nvarying float vWireA;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        // Ancho proyectado del cable en píxeles.
        float px = ${(WIRE_RADIUS * 2).toFixed(4)} * projectionMatrix[1][1] * uPxScale / max(-mvPosition.z, 0.1);
        vWireA = clamp(px * 2.0, 0.22, 0.95);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying float vWireA;\nvoid main() {')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n  gl_FragColor.a *= vWireA;');
  };
  mat.userData.pxScale = pxScale;
  return mat;
}

/** Líneas de cables listas para la escena (actualizan su escala de píxeles al dibujarse). */
export function wireLines(geometry, color) {
  const mat = wireMaterial(color);
  const lines = new THREE.LineSegments(geometry, mat);
  const size = new THREE.Vector2();
  lines.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(size);
    mat.userData.pxScale.value = size.y * 0.5;
  };
  lines.renderOrder = 2; // después de lo opaco
  return lines;
}
