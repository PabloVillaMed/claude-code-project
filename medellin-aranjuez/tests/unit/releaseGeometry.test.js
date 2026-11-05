import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WebGLAttributes } from 'three/src/renderers/webgl/WebGLAttributes.js';
import { geometryReleased, keepGeometryArrays, releaseStaticGeometry, retainedGeometryBytes } from '../../src/render/releaseGeometry.js';

// WebGL de mentira: lo justo para que WebGLAttributes de three "suba" buffers.
function fakeGl() {
  const uploads = [];
  return {
    uploads,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    FLOAT: 5126,
    HALF_FLOAT: 5131,
    SHORT: 5122,
    UNSIGNED_SHORT: 5123,
    INT: 5124,
    UNSIGNED_INT: 5125,
    BYTE: 5120,
    UNSIGNED_BYTE: 5121,
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: (target, array) => uploads.push(array.byteLength),
    bufferSubData: () => {},
    deleteBuffer: () => {},
  };
}

/** Sube a la "GPU" todos los atributos e índice, como hace three en el primer render. */
function upload(attrs, root) {
  root.traverse((o) => {
    const g = o.geometry;
    if (!g) return;
    for (const a of Object.values(g.attributes)) attrs.update(a, 34962);
    if (g.index) attrs.update(g.index, 34963);
  });
}

const box = () => new THREE.BoxGeometry(2, 2, 2, 4, 4, 4);
const mat = () => new THREE.MeshStandardMaterial();

describe('soltar arreglos de geometrías estáticas', () => {
  it('suelta posiciones, normales, UV e índice al subirlos, con límites ya calculados', () => {
    const root = new THREE.Group();
    const geo = box();
    geo.boundingBox = geo.boundingSphere = null;
    const mesh = new THREE.Mesh(geo, mat());
    root.add(mesh);
    const count = geo.attributes.position.count;
    const idxCount = geo.index.count;
    const before = retainedGeometryBytes(root);
    expect(before.bytes).toBeGreaterThan(0);

    const r = releaseStaticGeometry(root, { keep: false });
    expect(r.geometries).toBe(1);
    expect(r.bytes).toBe(before.bytes);
    expect(geo.boundingSphere).not.toBeNull();
    expect(geo.boundingBox).not.toBeNull();
    // Antes de subirse sigue todo.
    expect(geo.attributes.position.array).not.toBeNull();

    const gl = fakeGl();
    const attrs = new WebGLAttributes(gl);
    upload(attrs, root);
    expect(gl.uploads.reduce((a, b) => a + b, 0)).toBe(before.bytes);
    expect(geometryReleased(geo)).toBe(true);
    for (const a of [...Object.values(geo.attributes), geo.index]) expect(a.array).toBeNull();
    // Lo que three necesita para dibujar se conserva.
    expect(geo.attributes.position.count).toBe(count);
    expect(geo.index.count).toBe(idxCount);
    expect(attrs.get(geo.attributes.position).type).toBe(gl.FLOAT);
    expect(attrs.get(geo.attributes.position).bytesPerElement).toBe(4);
    // Un segundo cuadro no vuelve a subir ni rompe.
    upload(attrs, root);
    expect(retainedGeometryBytes(root)).toMatchObject({ bytes: 0, geometries: 1, released: 1 });
  });

  it('el descarte por cámara y el Raycaster siguen funcionando después de soltar', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(box(), mat());
    mesh.position.set(0, 0, -10);
    root.add(mesh);
    root.updateMatrixWorld(true);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    cam.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const rc = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
    expect(rc.intersectObject(root, true).length).toBeGreaterThan(0);

    releaseStaticGeometry(root, { keep: false });
    // Antes de subirse el Raycaster aún ve la malla.
    expect(rc.intersectObject(root, true).length).toBeGreaterThan(0);
    upload(new WebGLAttributes(fakeGl()), root);
    expect(frustum.intersectsObject(mesh)).toBe(true);
    expect(() => rc.intersectObject(root, true)).not.toThrow();
    expect(rc.intersectObject(root, true)).toEqual([]);
    expect(new THREE.Box3().setFromObject(mesh).isEmpty()).toBe(false);
  });

  it('no toca instancias, personajes, sprites, atributos dinámicos, wireframe ni morph', () => {
    const root = new THREE.Group();
    const inst = new THREE.InstancedMesh(box(), mat(), 4);
    const skinGeo = box();
    const n = skinGeo.attributes.position.count;
    skinGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    skinGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.25), 4));
    const skinned = new THREE.SkinnedMesh(skinGeo, mat());
    skinned.bind(new THREE.Skeleton([new THREE.Bone()]));
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial());
    const dynGeo = box();
    dynGeo.attributes.color = new THREE.Float32BufferAttribute(new Float32Array(dynGeo.attributes.position.count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const dyn = new THREE.Mesh(dynGeo, mat());
    const ranged = new THREE.Mesh(box(), mat());
    ranged.geometry.attributes.position.addUpdateRange(0, 3);
    const wire = new THREE.Mesh(box(), new THREE.MeshBasicMaterial({ wireframe: true }));
    const morphGeo = box();
    morphGeo.morphAttributes.position = [morphGeo.attributes.position.clone()];
    const morph = new THREE.Mesh(morphGeo, mat());
    root.add(inst, skinned, sprite, dyn, ranged, wire, morph);
    const r = releaseStaticGeometry(root, { keep: false });
    expect(r.geometries).toBe(0);
    upload(new WebGLAttributes(fakeGl()), root);
    root.traverse((o) => {
      if (o.geometry) expect(geometryReleased(o.geometry)).toBe(false);
    });
    expect(inst.instanceMatrix.array).not.toBeNull();
  });

  it('una geometría compartida con algo excluido o instanciado se queda', () => {
    const root = new THREE.Group();
    const shared = box();
    const viaInstance = box();
    const plain = new THREE.Mesh(shared, mat());
    const kept = new THREE.Group();
    kept.userData.keepGeometry = true;
    kept.add(new THREE.Mesh(shared, mat()));
    const a = new THREE.Mesh(viaInstance, mat());
    const b = new THREE.InstancedMesh(viaInstance, mat(), 2);
    const own = new THREE.Mesh(box(), mat());
    root.add(plain, kept, a, b, own);
    const r = releaseStaticGeometry(root, { keep: false });
    expect(r.geometries).toBe(1);
    upload(new WebGLAttributes(fakeGl()), root);
    expect(geometryReleased(own.geometry)).toBe(true);
    expect(geometryReleased(shared)).toBe(false);
    expect(geometryReleased(viaInstance)).toBe(false);
  });

  it('exclude() deja quieto el subárbol; minBytes deja las pequeñas', () => {
    const root = new THREE.Group();
    const vehicle = new THREE.Group();
    vehicle.name = 'vehiculo';
    vehicle.add(new THREE.Mesh(box(), mat()));
    const small = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat());
    const big = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat());
    root.add(vehicle, small, big);
    const r = releaseStaticGeometry(root, { keep: false, exclude: (o) => o.name === 'vehiculo', minBytes: 1024 });
    expect(r.geometries).toBe(1);
    upload(new WebGLAttributes(fakeGl()), root);
    expect(geometryReleased(big.geometry)).toBe(true);
    expect(geometryReleased(small.geometry)).toBe(false);
    expect(geometryReleased(vehicle.children[0].geometry)).toBe(false);
  });

  it('con ?exportar no suelta nada (el exportador de Unreal lee las geometrías)', () => {
    expect(keepGeometryArrays('?autotest=1&exportar=1')).toBe(true);
    expect(keepGeometryArrays('?quality=baja')).toBe(false);
    expect(keepGeometryArrays('')).toBe(false);
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(box(), mat());
    root.add(mesh);
    expect(releaseStaticGeometry(root, { keep: true }).geometries).toBe(0);
    upload(new WebGLAttributes(fakeGl()), root);
    expect(geometryReleased(mesh.geometry)).toBe(false);
  });

  it('líneas y puntos estáticos también se sueltan; llamar dos veces no duplica', () => {
    const root = new THREE.Group();
    const pts = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(300), 3));
    const lines = new THREE.LineSegments(pts.clone(), new THREE.LineBasicMaterial());
    root.add(new THREE.Points(pts, new THREE.PointsMaterial()), lines);
    expect(releaseStaticGeometry(root, { keep: false }).geometries).toBe(2);
    expect(releaseStaticGeometry(root, { keep: false }).geometries).toBe(0);
    upload(new WebGLAttributes(fakeGl()), root);
    expect(geometryReleased(pts)).toBe(true);
    expect(geometryReleased(lines.geometry)).toBe(true);
    expect(pts.boundingSphere.radius).toBe(0);
  });
});
