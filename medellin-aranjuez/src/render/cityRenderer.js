// Construye la escena 3D del barrio a partir del layout de la simulación.

import * as THREE from 'three';
import { GeoBuilder } from './geoBuilder.js';
import { textTexture } from './textures.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../sim/rng.js';
import {
  GRID,
  MAP_MAX_X,
  MAP_MAX_Z,
  MAP_MIN_X,
  MAP_MIN_Z,
  backdropHeight,
  terrainHeight,
} from '../sim/terrain.js';

const FACADE_M = 12; // metros que cubre una textura de fachada
const PARAPET = 0.7;

export class CityRenderer {
  constructor(scene, city, tex, quality) {
    this.scene = scene;
    this.city = city;
    this.tex = tex;
    this.quality = quality;
    this.root = new THREE.Group();
    this.root.name = 'ciudad';
    scene.add(this.root);
    this.nightMaterials = []; // materiales cuya emisión depende de la noche
    this.lampGlow = null;
    this.cityLights = null;
    this.materials = this._materials();
    this._terrain();
    this._backdrop();
    this._roads();
    this._blocks();
    this._buildings();
    this._props();
    this._metro();
  }

  // ---------------------------------------------------------------- materiales
  _materials() {
    const t = this.tex;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const facade = (set, rough = 0.88) =>
      set.map((f) => {
        const m = std({ map: f.map, normalMap: f.normalMap, roughness: rough, metalness: 0, vertexColors: true, emissiveMap: f.emissiveMap, emissive: new THREE.Color(0xffc27a), emissiveIntensity: 0 });
        this.nightMaterials.push({ m, max: 1.4 });
        return m;
      });
    const rep = (texSet, r) => {
      const o = { map: texSet.map, normalMap: texSet.normalMap, roughness: r, metalness: 0 };
      return std(o);
    };
    const roadMat = (set) => {
      const m = std({ map: set.map, normalMap: set.normalMap, roughness: 0.93, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      m.normalScale.set(0.6, 0.6);
      return m;
    };
    const towerMat = facade([t.tower], 0.6)[0];
    return {
      brick: facade(t.brick),
      stucco: facade(t.stucco),
      tower: towerMat,
      mural: t.mural.map((m) => std({ map: m, roughness: 0.85, vertexColors: true })),
      concrete: std({ map: t.concrete.map, normalMap: t.concrete.normalMap, roughness: 0.95, vertexColors: true }),
      roof: std({ map: t.roof.map, normalMap: t.roof.normalMap, roughness: 0.97 }),
      tiles: std({ map: t.tiles.map, normalMap: t.tiles.normalMap, roughness: 0.8 }),
      metal: std({ map: t.metal.map, normalMap: t.metal.normalMap, roughness: 0.45, metalness: 0.6 }),
      plain: std({ roughness: 0.85, vertexColors: true }),
      glossy: new THREE.MeshPhysicalMaterial({ roughness: 0.25, vertexColors: true, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
      asphalt: roadMat(t.asphalt),
      asphaltPlain: roadMat(t.asphaltPlain),
      sidewalk: rep(t.sidewalk, 0.9),
      pavers: rep(t.pavers, 0.85),
      grass: rep(t.grass, 0.97),
      dryGrass: rep(t.dryGrass, 0.97),
      field: rep(t.field, 0.95),
      terrain: std({ map: t.grass.map, normalMap: t.grass.normalMap, roughness: 1, vertexColors: true }),
      water: new THREE.MeshPhysicalMaterial({ color: 0x2b4a4f, roughness: 0.06, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.2 }),
      wood: std({ color: 0x7a5534, roughness: 0.7 }),
      darkMetal: std({ color: 0x23262a, roughness: 0.5, metalness: 0.7 }),
      white: std({ color: 0xf2f2ee, roughness: 0.4 }),
    };
  }

  _mesh(geo, mat, { cast = true, receive = true, name } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    if (name) m.name = name;
    this.root.add(m);
    return m;
  }

  // ---------------------------------------------------------------- terreno
  _terrain() {
    const pad = 110;
    const g = new GeoBuilder();
    const step = 2.5;
    const rng = makeRng(3);
    const x0 = MAP_MIN_X - pad;
    const x1 = MAP_MAX_X + pad;
    const z0 = MAP_MIN_Z - pad;
    const z1 = MAP_MAX_Z + pad;
    // Rejilla por franjas para no crear un solo arreglo gigantesco.
    const col = [0.9, 0.95, 0.85];
    g.heightGrid(x0, z0, x1, z1, step, terrainHeight, 8, col);
    // Variación de color (tierra seca / pasto) por vértice.
    for (let i = 0; i < g.col.length; i += 3) {
      const x = g.pos[i];
      const z = g.pos[i + 2];
      const n = 0.5 + 0.5 * Math.sin(x * 0.05 + z * 0.03) * Math.cos(z * 0.07 - x * 0.02);
      const k = 0.75 + 0.3 * n + rng.range(-0.04, 0.04);
      g.col[i] = k * (1 + (1 - n) * 0.25);
      g.col[i + 1] = k;
      g.col[i + 2] = k * 0.85;
    }
    this._mesh(g.build(), this.materials.terrain, { cast: false, name: 'terreno' });
  }

  _backdrop() {
    // Valle de Aburrá: laderas con miles de casas y luces nocturnas.
    const size = 5200;
    const seg = 260;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const inner = { minX: MAP_MIN_X - 100, maxX: MAP_MAX_X + 100, minZ: MAP_MIN_Z - 100, maxZ: MAP_MAX_Z + 100 };
    // Zona urbana en la parte baja de las laderas, verde arriba.
    const urban = (x, z) => {
      const h = backdropHeight(x, z);
      return h < 180 ? 1 : h < 260 ? 1 - (h - 180) / 80 : 0;
    };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let y = backdropHeight(x, z);
      if (x > inner.minX && x < inner.maxX && z > inner.minZ && z < inner.maxZ) y -= 8;
      pos.setY(i, y);
      const u = urban(x, z);
      // Ladrillo/teja (urbano) mezclado con verde de montaña.
      colors[i * 3] = 0.3 + u * 0.28;
      colors[i * 3 + 1] = 0.36 - u * 0.1;
      colors[i * 3 + 2] = 0.2 - u * 0.02;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const mesh = this._mesh(geo, mat, { cast: false, name: 'valle' });
    mesh.receiveShadow = false;

    // Casas lejanas (instanciadas) y luces nocturnas.
    const rng = makeRng(99);
    const count = this.quality.backdropHouses;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const houseMat = new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: false });
    const houses = new THREE.InstancedMesh(box, houseMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const lightPos = [];
    const lightCol = [];
    let n = 0;
    let tries = 0;
    while (n < count && tries < count * 6) {
      tries++;
      const x = rng.range(-2400, 2400);
      const z = rng.range(-2400, 2400);
      if (x > inner.minX - 60 && x < inner.maxX + 60 && z > inner.minZ - 60 && z < inner.maxZ + 60) continue;
      // Río: franja sin casas.
      if (Math.abs(x - (MAP_MIN_X - 620)) < 70) continue;
      if (urban(x, z) < rng.next()) continue;
      const y = backdropHeight(x, z);
      const w = rng.range(6, 12);
      const h = rng.range(4, 12) * (rng.chance(0.06) ? 4 : 1);
      p.set(x, y - 1, z);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng.chance(0.5) ? 0 : 0.3);
      s.set(w, h, rng.range(6, 12));
      m.compose(p, q, s);
      houses.setMatrixAt(n, m);
      const r = rng.next();
      if (r < 0.6) c.setRGB(0.55 + rng.range(-0.08, 0.08), 0.28, 0.18);
      else if (r < 0.85) c.setRGB(0.8, 0.78, 0.72);
      else c.setHSL(rng.next(), 0.4, 0.6);
      houses.setColorAt(n, c);
      if (rng.chance(0.7)) {
        lightPos.push(x, y + h * 0.6, z);
        const warm = rng.chance(0.8);
        lightCol.push(1, warm ? 0.72 : 0.95, warm ? 0.38 : 0.85);
      }
      n++;
    }
    houses.count = n;
    houses.receiveShadow = false;
    houses.castShadow = false;
    this.root.add(houses);

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lightPos, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lightCol, 3));
    const lm = new THREE.PointsMaterial({ size: 4.5, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, map: glowSprite() });
    this.cityLights = new THREE.Points(lg, lm);
    this.cityLights.frustumCulled = false;
    this.root.add(this.cityLights);

    // Río Medellín.
    const rx = MAP_MIN_X - 620;
    const river = new THREE.Mesh(new THREE.PlaneGeometry(46, 5200, 1, 1).rotateX(-Math.PI / 2), this.materials.water);
    river.position.set(rx, backdropHeight(rx, 0) + 1.2, 0);
    river.receiveShadow = false;
    this.root.add(river);
  }

  // ---------------------------------------------------------------- vías
  _roads() {
    const g = new GeoBuilder();
    const gi = new GeoBuilder();
    const H = GRID.asphaltHalf;
    const lift = 0.03;
    const step = 3;
    const hf = (x, z) => terrainHeight(x, z) + lift;
    for (const e of this.city.edges) {
      const a = this.city.nodes[e.a];
      const b = this.city.nodes[e.b];
      const len = e.length - 2 * H;
      const n = Math.ceil(len / step);
      const base = g.vertexCount;
      const dx = (b.x - a.x) / e.length;
      const dz = (b.z - a.z) / e.length;
      const rx = -dz;
      const rz = dx;
      for (let k = 0; k <= n; k++) {
        const t = H + (len * k) / n;
        const cx = a.x + dx * t;
        const cz = a.z + dz * t;
        for (let s = 0; s <= 2; s++) {
          const off = -H + s * H;
          const x = cx + rx * off;
          const z = cz + rz * off;
          g.vertex(x, hf(x, z), z, 0, 1, 0, s / 2, t / 9);
        }
      }
      for (let k = 0; k < n; k++) {
        for (let s = 0; s < 2; s++) {
          const i0 = base + k * 3 + s;
          const i1 = i0 + 1;
          const i2 = i0 + 3;
          const i3 = i2 + 1;
          // Orientación para normal hacia arriba según el sentido de la arista.
          g.idx.push(i0, i1, i2, i1, i3, i2);
        }
      }
    }
    for (const nd of this.city.nodes) {
      if (!nd.active) continue;
      gi.heightGrid(nd.x - H, nd.z - H, nd.x + H, nd.z + H, 3, hf, 9);
    }
    const geo = g.build();
    geo.computeVertexNormals();
    this._mesh(geo, this.materials.asphalt, { cast: false, name: 'vias' });
    this._mesh(gi.build(), this.materials.asphaltPlain, { cast: false, name: 'intersecciones' });
  }

  // ---------------------------------------------------------------- manzanas
  _blocks() {
    const ring = new GeoBuilder();
    const curb = new GeoBuilder();
    const interiors = {};
    const hf = (x, z) => terrainHeight(x, z) + GRID.curb;
    const sw = GRID.sidewalk;
    const interiorMat = { parque: 'pavers', mirador: 'pavers', botanico: 'grass', moravia: 'grass', cancha: 'dryGrass', cementerio: 'grass', parqueadero: 'asphaltPlain' };
    for (const b of this.city.blocks) {
      const { minX, maxX, minZ, maxZ } = b;
      // Andén perimetral (4 franjas).
      ring.heightGrid(minX, minZ, maxX, minZ + sw, 3, hf, 4);
      ring.heightGrid(minX, maxZ - sw, maxX, maxZ, 3, hf, 4);
      ring.heightGrid(minX, minZ + sw, minX + sw, maxZ - sw, 3, hf, 4);
      ring.heightGrid(maxX - sw, minZ + sw, maxX, maxZ - sw, 3, hf, 4);
      const key = interiorMat[b.type] ?? 'sidewalk';
      interiors[key] ??= new GeoBuilder();
      interiors[key].heightGrid(minX + sw, minZ + sw, maxX - sw, maxZ - sw, 4, hf, key === 'sidewalk' || key === 'pavers' ? 4 : 10);
      // Sardinel: caras laterales del andén.
      const edges = [
        [maxX, minZ, 0, -1, maxX - minX],
        [minX, maxZ, 0, 1, maxX - minX],
        [minX, minZ, -1, 0, maxZ - minZ],
        [maxX, maxZ, 1, 0, maxZ - minZ],
      ];
      for (const [sx, sz, nx, nz, len] of edges) {
        const rx = nz;
        const rz = -nx;
        const segs = Math.ceil(len / 3);
        for (let k = 0; k < segs; k++) {
          const t0 = (len * k) / segs;
          const t1 = (len * (k + 1)) / segs;
          const ax = sx + rx * t0;
          const az = sz + rz * t0;
          const bx = sx + rx * t1;
          const bz = sz + rz * t1;
          const ya = terrainHeight(ax, az);
          const yb = terrainHeight(bx, bz);
          curb.quad(
            [ax, ya - 0.05, az],
            [bx, yb - 0.05, bz],
            [bx, yb + GRID.curb, bz],
            [ax, ya + GRID.curb, az],
            [nx, 0, nz],
            [
              [t0 / 2, 0],
              [t1 / 2, 0],
              [t1 / 2, 0.1],
              [t0 / 2, 0.1],
            ],
            [0.85, 0.83, 0.8],
          );
        }
      }
    }
    this._mesh(ring.build(), this.materials.sidewalk, { cast: false, name: 'andenes' });
    this._mesh(curb.build(), this.materials.concrete, { cast: false, name: 'sardineles' });
    for (const [k, gb] of Object.entries(interiors)) this._mesh(gb.build(), this.materials[k], { cast: false, name: `interior-${k}` });
  }

  // ---------------------------------------------------------------- edificios
  _buildings() {
    const groups = new Map();
    const get = (key) => {
      if (!groups.has(key)) groups.set(key, new GeoBuilder());
      return groups.get(key);
    };
    const roof = get('roof');
    const concrete = get('concrete');
    const tiles = get('tiles');
    const railing = get('darkMetal');
    const tanks = [];
    const rebar = [];
    const rng = makeRng(123);
    const murals = [];

    for (const b of this.city.buildings) {
      const { minX, maxX, minZ, maxZ, groundY, topY, baseY } = b;
      const w = maxX - minX;
      const d = maxZ - minZ;
      let matKey;
      let color = b.color;
      switch (b.style) {
        case 'ladrillo':
          matKey = `brick${rng.int(0, 1)}`;
          break;
        case 'torre':
          matKey = 'tower';
          break;
        case 'pintada':
        case 'tienda':
        case 'hospital':
          matKey = `stucco${rng.int(0, 1)}`;
          break;
        case 'museo':
          matKey = 'mural0';
          color = [1, 1, 1];
          break;
        case 'taller':
          matKey = 'metal';
          break;
        case 'explora':
          matKey = 'glossy';
          break;
        default:
          matKey = 'plain';
      }
      const g = get(matKey);
      const uOff = Math.floor(b.uvOffset * 4) / 4;
      const faces = [
        [maxX, minZ, 0, -1, w, 'N'],
        [minX, maxZ, 0, 1, w, 'S'],
        [minX, minZ, -1, 0, d, 'W'],
        [maxX, maxZ, 1, 0, d, 'E'],
      ];
      const isWall = b.style === 'muro';
      const uvScale = matKey === 'plain' || matKey === 'glossy' ? 4 : matKey === 'metal' ? 3 : FACADE_M;
      const parapet = b.roof === 'flat' && !isWall && !['explora', 'iglesia'].includes(b.style) ? PARAPET : 0;
      for (const [x0, z0, nx, nz, len] of faces) {
        // Cimiento visible en la ladera (concreto) + fachada.
        if (groundY - baseY > 0.05) concrete.wall(x0, z0, nx, nz, len, baseY, groundY, 3, [0.8, 0.78, 0.74]);
        g.wall(x0, z0, nx, nz, len, groundY, topY + parapet, uvScale, color, uOff, groundY);
      }
      // Murales en culatas laterales de algunas casas (arte urbano).
      if (b.style !== 'torre' && !isWall && rng.chance(0.05) && topY - groundY > 5) murals.push(b);

      if (isWall || b.style === 'explora') {
        const gg = isWall ? get('plain') : g;
        gg.quad([minX, topY, maxZ], [maxX, topY, maxZ], [maxX, topY, minZ], [minX, topY, minZ], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], color);
        continue;
      }
      if (b.roof === 'tejas') {
        this._gableRoof(tiles, concrete, b);
      } else {
        roof.quad([minX, topY, maxZ], [maxX, topY, maxZ], [maxX, topY, minZ], [minX, topY, minZ], [0, 1, 0], [[minX / 6, maxZ / 6], [maxX / 6, maxZ / 6], [maxX / 6, minZ / 6], [minX / 6, minZ / 6]]);
        if (parapet) {
          const t = 0.18;
          const top = topY + parapet;
          // Caras internas del muro de la terraza y remate.
          roof.wall(minX + t, minZ + t, 0, 1, w - 2 * t, topY, top, 3);
          roof.wall(maxX - t, maxZ - t, 0, -1, w - 2 * t, topY, top, 3);
          roof.wall(minX + t, maxZ - t, 1, 0, d - 2 * t, topY, top, 3);
          roof.wall(maxX - t, minZ + t, -1, 0, d - 2 * t, topY, top, 3);
          concrete.quad([minX, top, maxZ], [maxX, top, maxZ], [maxX, top, maxZ - t], [minX, top, maxZ - t], [0, 1, 0], [[0, 0], [1, 0], [1, 0.05], [0, 0.05]], [0.85, 0.85, 0.82]);
          concrete.quad([minX, top, minZ + t], [maxX, top, minZ + t], [maxX, top, minZ], [minX, top, minZ], [0, 1, 0], [[0, 0], [1, 0], [1, 0.05], [0, 0.05]], [0.85, 0.85, 0.82]);
          concrete.quad([minX, top, maxZ - t], [minX + t, top, maxZ - t], [minX + t, top, minZ + t], [minX, top, minZ + t], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.85, 0.85, 0.82]);
          concrete.quad([maxX - t, top, maxZ - t], [maxX, top, maxZ - t], [maxX, top, minZ + t], [maxX - t, top, minZ + t], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.85, 0.85, 0.82]);
        }
        if (b.tank) tanks.push({ x: minX + 1.4 + rng.next() * Math.max(0.1, w - 2.8), z: minZ + 1.4 + rng.next() * Math.max(0.1, d - 2.8), y: topY, blue: rng.chance(0.35) });
        // Varillas a la vista para "el segundo piso que viene" (muy paisa).
        if (b.floors <= 4 && rng.chance(0.35)) {
          for (const [cx, cz] of [[minX + 0.25, minZ + 0.25], [maxX - 0.25, minZ + 0.25], [minX + 0.25, maxZ - 0.25], [maxX - 0.25, maxZ - 0.25]]) {
            for (let k = 0; k < 4; k++) rebar.push(cx + (k % 2) * 0.1, topY + parapet, cz + (k >> 1) * 0.1, cx + (k % 2) * 0.1 + rng.range(-0.05, 0.05), topY + parapet + rng.range(0.8, 1.4), cz + (k >> 1) * 0.1);
          }
        }
      }
      // Balcones con baranda en la fachada principal.
      if (b.balcony && b.front) this._balconies(concrete, railing, b);
      if (b.tower) {
        // Campanario: remate piramidal.
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;
        const h = 5;
        const pts = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
        for (let k = 0; k < 4; k++) {
          const [ax, az] = pts[k];
          const [bx, bz] = pts[(k + 1) % 4];
          const nx = (az + bz) / 2 - cz;
          const nz = -((ax + bx) / 2 - cx);
          const l = Math.hypot(nx, nz) || 1;
          tiles.tri([bx, topY, bz], [ax, topY, az], [cx, topY + h, cz], [-nz / l, 0.5, nx / l], [[0, 0], [1, 0], [0.5, 1]]);
        }
      }
    }

    for (const [key, gb] of groups) {
      let mat;
      if (key.startsWith('brick')) mat = this.materials.brick[+key.slice(5)];
      else if (key.startsWith('stucco')) mat = this.materials.stucco[+key.slice(6)];
      else if (key.startsWith('mural')) mat = this.materials.mural[+key.slice(5)];
      else mat = this.materials[key];
      this._mesh(gb.build(), mat, { name: `edificios-${key}` });
    }

    // Murales: planos pegados a las culatas.
    for (const b of murals) {
      const tex = new THREE.MeshStandardMaterial({ map: this.tex.mural[rng.int(0, 2)], roughness: 0.85 });
      const h = Math.min(8, b.topY - b.groundY - 1);
      const len = Math.min(10, b.maxZ - b.minZ - 1);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(len, h), tex);
      const side = b.front === 'N' || b.front === 'S' ? (rng.chance(0.5) ? 'W' : 'E') : rng.chance(0.5) ? 'N' : 'S';
      const cy = b.groundY + 1 + h / 2;
      if (side === 'W') plane.position.set(b.minX - 0.03, cy, (b.minZ + b.maxZ) / 2), (plane.rotation.y = -Math.PI / 2);
      else if (side === 'E') plane.position.set(b.maxX + 0.03, cy, (b.minZ + b.maxZ) / 2), (plane.rotation.y = Math.PI / 2);
      else if (side === 'N') plane.position.set((b.minX + b.maxX) / 2, cy, b.minZ - 0.03), (plane.rotation.y = Math.PI);
      else plane.position.set((b.minX + b.maxX) / 2, cy, b.maxZ + 0.03);
      plane.receiveShadow = true;
      this.root.add(plane);
    }

    // Tanques de agua (negros tipo Eternit o azules).
    if (tanks.length) {
      const geo = new THREE.CylinderGeometry(0.7, 0.75, 1.3, 14);
      geo.translate(0, 0.65, 0);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
      const im = new THREE.InstancedMesh(geo, mat, tanks.length);
      const m = new THREE.Matrix4();
      const c = new THREE.Color();
      tanks.forEach((t, i) => {
        m.makeTranslation(t.x, t.y, t.z);
        im.setMatrixAt(i, m);
        im.setColorAt(i, t.blue ? c.setRGB(0.1, 0.3, 0.65) : c.setRGB(0.07, 0.07, 0.08));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      this.root.add(im);
    }
    if (rebar.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(rebar, 3));
      this.root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x5a3a24 })));
    }
  }

  _gableRoof(tiles, walls, b) {
    const { minX, maxX, minZ, maxZ, topY } = b;
    const alongX = maxX - minX >= maxZ - minZ;
    const rise = 1.6;
    const o = 0.4; // alero
    if (alongX) {
      const zc = (minZ + maxZ) / 2;
      const hy = topY + rise;
      const s = Math.hypot(rise, (maxZ - minZ) / 2);
      const ny = ((maxZ - minZ) / 2) / s;
      const nz = rise / s;
      tiles.quad([minX - o, topY - 0.2, maxZ + o], [maxX + o, topY - 0.2, maxZ + o], [maxX + o, hy, zc], [minX - o, hy, zc], [0, ny, nz], [[0, 0], [(maxX - minX) / 3, 0], [(maxX - minX) / 3, s / 3], [0, s / 3]]);
      tiles.quad([maxX + o, topY - 0.2, minZ - o], [minX - o, topY - 0.2, minZ - o], [minX - o, hy, zc], [maxX + o, hy, zc], [0, ny, -nz], [[0, 0], [(maxX - minX) / 3, 0], [(maxX - minX) / 3, s / 3], [0, s / 3]]);
      walls.tri([minX, topY, minZ], [minX, topY, maxZ], [minX, hy, zc], [-1, 0, 0], [[0, 0], [1, 0], [0.5, 0.5]], [0.9, 0.88, 0.84]);
      walls.tri([maxX, topY, maxZ], [maxX, topY, minZ], [maxX, hy, zc], [1, 0, 0], [[0, 0], [1, 0], [0.5, 0.5]], [0.9, 0.88, 0.84]);
    } else {
      const xc = (minX + maxX) / 2;
      const hy = topY + rise;
      const s = Math.hypot(rise, (maxX - minX) / 2);
      const ny = ((maxX - minX) / 2) / s;
      const nx = rise / s;
      tiles.quad([maxX + o, topY - 0.2, maxZ + o], [maxX + o, topY - 0.2, minZ - o], [xc, hy, minZ - o], [xc, hy, maxZ + o], [nx, ny, 0], [[0, 0], [(maxZ - minZ) / 3, 0], [(maxZ - minZ) / 3, s / 3], [0, s / 3]]);
      tiles.quad([minX - o, topY - 0.2, minZ - o], [minX - o, topY - 0.2, maxZ + o], [xc, hy, maxZ + o], [xc, hy, minZ - o], [-nx, ny, 0], [[0, 0], [(maxZ - minZ) / 3, 0], [(maxZ - minZ) / 3, s / 3], [0, s / 3]]);
      walls.tri([maxX, topY, minZ], [minX, topY, minZ], [xc, hy, minZ], [0, 0, -1], [[0, 0], [1, 0], [0.5, 0.5]], [0.9, 0.88, 0.84]);
      walls.tri([minX, topY, maxZ], [maxX, topY, maxZ], [xc, hy, maxZ], [0, 0, 1], [[0, 0], [1, 0], [0.5, 0.5]], [0.9, 0.88, 0.84]);
    }
  }

  _balconies(concrete, railing, b) {
    const { minX, maxX, minZ, maxZ, groundY } = b;
    const depth = 0.9;
    const along = b.front === 'N' || b.front === 'S';
    const len = along ? maxX - minX : maxZ - minZ;
    const bw = Math.min(4.2, len * 0.6);
    const c0 = (along ? (minX + maxX) / 2 : (minZ + maxZ) / 2) - bw / 2;
    for (let f = 1; f < b.floors; f++) {
      const y = groundY + f * 3;
      let box;
      if (b.front === 'N') box = [c0, minZ - depth, c0 + bw, minZ];
      else if (b.front === 'S') box = [c0, maxZ, c0 + bw, maxZ + depth];
      else if (b.front === 'W') box = [minX - depth, c0, minX, c0 + bw];
      else box = [maxX, c0, maxX + depth, c0 + bw];
      const [x0, z0, x1, z1] = box;
      concrete.box(x0, y - 0.15, z0, x1, y, z1, 2, [0.85, 0.84, 0.8], false);
      // Baranda: pasamanos y barrotes finos.
      const rh = 1.0;
      if (b.front === 'N') railing.box(x0, y + rh - 0.05, z0, x1, y + rh, z0 + 0.05);
      else if (b.front === 'S') railing.box(x0, y + rh - 0.05, z1 - 0.05, x1, y + rh, z1);
      else if (b.front === 'W') railing.box(x0, y + rh - 0.05, z0, x0 + 0.05, y + rh, z1);
      else railing.box(x1 - 0.05, y + rh - 0.05, z0, x1, y + rh, z1);
      const n = Math.floor(bw / 0.25);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        if (b.front === 'N') railing.box(x0 + (x1 - x0) * t, y, z0, x0 + (x1 - x0) * t + 0.03, y + rh, z0 + 0.03);
        else if (b.front === 'S') railing.box(x0 + (x1 - x0) * t, y, z1 - 0.03, x0 + (x1 - x0) * t + 0.03, y + rh, z1);
        else if (b.front === 'W') railing.box(x0, y, z0 + (z1 - z0) * t, x0 + 0.03, y + rh, z0 + (z1 - z0) * t + 0.03);
        else railing.box(x1 - 0.03, y, z0 + (z1 - z0) * t, x1, y + rh, z0 + (z1 - z0) * t + 0.03);
      }
    }
  }

  // ---------------------------------------------------------------- utilería
  _props() {
    const props = this.city.props;
    const byType = {};
    for (const p of props) (byType[p.type] ??= []).push(p);
    this._trees(byType.tree ?? []);
    this._lamps(byType.lamp ?? []);
    this._poles(byType.pole ?? [], byType.cable ?? []);
    this._benches(byType.bench ?? []);
    for (const p of byType.sign ?? []) this._sign(p);
    for (const p of byType.fountain ?? []) this._fountain(p);
    for (const p of byType.kiosk ?? []) this._kiosk(p);
    for (const p of byType.goal ?? []) this._goal(p);
    for (const p of byType.fence ?? []) this._fence(p);
    for (const p of byType.field ?? []) this._field(p);
    for (const p of byType.orquideorama ?? []) this._orquideorama(p);
    for (const p of byType.pond ?? []) this._pond(p);
    for (const p of byType.parking ?? []) this._parking(p);
    for (const p of byType.railing ?? []) this._railing(p);
    this._tombs(byType.tomb ?? []);
    this._flowers([...(byType.garden ?? [])]);
  }

  _trees(trees) {
    const rng = makeRng(77);
    const kinds = {
      guayacan: { canopy: [0.95, 0.76, 0.12], h: 6, r: 3.2 },
      guayacanRosado: { canopy: [0.9, 0.52, 0.66], h: 6, r: 3.2 },
      mango: { canopy: [0.16, 0.33, 0.12], h: 5.5, r: 3.8 },
      ficus: { canopy: [0.22, 0.4, 0.16], h: 5, r: 2.6 },
      ceiba: { canopy: [0.25, 0.42, 0.18], h: 11, r: 7 },
    };
    const normal = trees.filter((t) => t.kind !== 'palma');
    const palms = trees.filter((t) => t.kind === 'palma');
    // Copa: racimo de esferas deformadas para un contorno orgánico.
    const canopyGeo = (() => {
      const parts = [];
      const r2 = makeRng(5);
      for (let k = 0; k < 5; k++) {
        const s = new THREE.IcosahedronGeometry(k === 0 ? 1 : r2.range(0.55, 0.75), 2);
        const pos = s.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, i);
          const n = 1 + 0.12 * Math.sin(v.x * 7 + k) * Math.cos(v.y * 6) * Math.sin(v.z * 5);
          v.multiplyScalar(n);
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        if (k > 0) s.translate(r2.range(-0.6, 0.6), r2.range(-0.2, 0.35), r2.range(-0.6, 0.6));
        parts.push(s);
      }
      let merged = mergeGeos(parts);
      merged.deleteAttribute('uv');
      merged = mergeVertices(merged, 1e-3);
      merged.scale(1, 0.72, 1);
      merged.computeVertexNormals();
      // Oclusión falsa: la copa es más oscura por debajo y por dentro.
      const pos = merged.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        const k = Math.min(1.1, 0.45 + (y + 0.7) * 0.45 + r * 0.12);
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
      }
      merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return merged;
    })();
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.26, 1, 7);
    trunkGeo.translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true, normalMap: this.tex.grass.normalMap, normalScale: new THREE.Vector2(2.5, 2.5) });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, normal.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, leafMat, normal.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    normal.forEach((t, i) => {
      const k = kinds[t.kind] ?? kinds.ficus;
      const sc = t.scale ?? 1;
      const y = terrainHeight(t.x, t.z) + (t.onBlock === false ? 0 : GRID.curb);
      const h = k.h * sc;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng.next() * 6.28);
      m.compose(v.set(t.x, y, t.z), q, s.set(sc * (k.r / 3), h * 0.7, sc * (k.r / 3)));
      trunks.setMatrixAt(i, m);
      m.compose(v.set(t.x, y + h * 0.72, t.z), q, s.set(k.r * sc * 0.55, k.r * sc * 0.55, k.r * sc * 0.55));
      canopies.setMatrixAt(i, m);
      const j = rng.range(0.85, 1.12);
      canopies.setColorAt(i, c.setRGB(k.canopy[0] * j, k.canopy[1] * j, k.canopy[2] * j));
    });
    for (const im of [trunks, canopies]) {
      im.castShadow = true;
      im.receiveShadow = true;
      this.root.add(im);
    }
    // Palmas.
    if (palms.length) {
      const ptrunk = new THREE.CylinderGeometry(0.16, 0.24, 1, 8);
      ptrunk.translate(0, 0.5, 0);
      const fronds = [];
      for (let k = 0; k < 9; k++) {
        const f = new THREE.PlaneGeometry(0.7, 3.2, 1, 4);
        f.translate(0, 1.6, 0);
        const pos = f.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          pos.setZ(i, -0.12 * y * y);
          pos.setX(i, pos.getX(i) * (1 - y / 3.6));
        }
        f.rotateX(-Math.PI / 2 + 0.5);
        f.rotateY((k / 9) * Math.PI * 2);
        fronds.push(f);
      }
      const frondGeo = mergeGeos(fronds);
      frondGeo.computeVertexNormals();
      const pt = new THREE.InstancedMesh(ptrunk, trunkMat, palms.length);
      const pf = new THREE.InstancedMesh(frondGeo, new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 0.8, side: THREE.DoubleSide }), palms.length);
      palms.forEach((t, i) => {
        const y = terrainHeight(t.x, t.z) + GRID.curb;
        const h = 8 * (t.scale ?? 1);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng.next() * 6.28);
        m.compose(v.set(t.x, y, t.z), q, s.set(1, h, 1));
        pt.setMatrixAt(i, m);
        m.compose(v.set(t.x, y + h, t.z), q, s.set(1, 1, 1));
        pf.setMatrixAt(i, m);
      });
      for (const im of [pt, pf]) {
        im.castShadow = true;
        im.receiveShadow = true;
        this.root.add(im);
      }
    }
  }

  _lamps(lamps) {
    const pole = new THREE.CylinderGeometry(0.07, 0.11, 8, 6);
    pole.translate(0, 4, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1.8);
    arm.translate(0, 7.9, -0.9);
    const head = new THREE.BoxGeometry(0.35, 0.14, 0.7);
    head.translate(0, 7.82, -1.75);
    const poleGeo = mergeGeos([pole, arm]);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x6e7479, roughness: 0.5, metalness: 0.6 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffc27a, emissiveIntensity: 0 });
    this.nightMaterials.push({ m: headMat, max: 6 });
    const pm = new THREE.InstancedMesh(poleGeo, poleMat, lamps.length);
    const hm = new THREE.InstancedMesh(head, headMat, lamps.length);
    // Charco de luz falso en el piso (barato y convincente de noche).
    const glowGeo = new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({ map: glowSprite(), color: 0xffb865, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
    const gm = new THREE.InstancedMesh(glowGeo, glowMat, lamps.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    lamps.forEach((l, i) => {
      const y = terrainHeight(l.x, l.z) + GRID.curb;
      // El brazo apunta hacia la calle.
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, l.rot);
      m.compose(v.set(l.x, y, l.z), q, one);
      pm.setMatrixAt(i, m);
      hm.setMatrixAt(i, m);
      const dir = new THREE.Vector3(0, 0, -1.75).applyQuaternion(q);
      m.compose(v.set(l.x + dir.x, terrainHeight(l.x + dir.x, l.z + dir.z) + 0.08, l.z + dir.z), new THREE.Quaternion(), one);
      gm.setMatrixAt(i, m);
    });
    pm.castShadow = true;
    this.root.add(pm, hm, gm);
    this.lampGlow = glowMat;
  }

  _poles(poles, cables) {
    const pole = new THREE.CylinderGeometry(0.12, 0.18, 9, 6);
    pole.translate(0, 4.5, 0);
    const cross = new THREE.BoxGeometry(1.8, 0.12, 0.12);
    cross.translate(0, 8.4, 0);
    const im = new THREE.InstancedMesh(mergeGeos([pole, cross]), new THREE.MeshStandardMaterial({ color: 0x9d9a93, roughness: 0.9 }), poles.length);
    const m = new THREE.Matrix4();
    poles.forEach((p, i) => {
      m.makeTranslation(p.x, terrainHeight(p.x, p.z) + GRID.curb, p.z);
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    this.root.add(im);
    // Cables con catenaria (el enredo de cables es parte del paisaje).
    const pts = [];
    for (const c of cables) {
      const ya = terrainHeight(c.a.x, c.a.z) + GRID.curb;
      const yb = terrainHeight(c.b.x, c.b.z) + GRID.curb;
      for (const [ox, oh] of [[-0.8, 8.5], [0, 8.5], [0.8, 8.5], [0.3, 7.6]]) {
        const n = 10;
        for (let k = 0; k < n; k++) {
          const t0 = k / n;
          const t1 = (k + 1) / n;
          const sag = (t) => -1.1 * 4 * t * (1 - t);
          pts.push(c.a.x + ox + (c.b.x - c.a.x) * t0, ya + oh + (yb - ya) * t0 + sag(t0), c.a.z + (c.b.z - c.a.z) * t0);
          pts.push(c.a.x + ox + (c.b.x - c.a.x) * t1, ya + oh + (yb - ya) * t1 + sag(t1), c.a.z + (c.b.z - c.a.z) * t1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x151515 })));
  }

  _benches(benches) {
    const seat = new THREE.BoxGeometry(1.8, 0.08, 0.45);
    seat.translate(0, 0.45, 0);
    const back = new THREE.BoxGeometry(1.8, 0.45, 0.06);
    back.translate(0, 0.75, -0.2);
    const l1 = new THREE.BoxGeometry(0.08, 0.45, 0.45);
    l1.translate(-0.8, 0.22, 0);
    const l2 = l1.clone();
    l2.translate(1.6, 0, 0);
    const im = new THREE.InstancedMesh(mergeGeos([seat, back, l1, l2]), this.materials.wood, benches.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    benches.forEach((b, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, b.rot ?? 0);
      m.compose(v.set(b.x, terrainHeight(b.x, b.z) + GRID.curb, b.z), q, one);
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    this.root.add(im);
  }

  _sign(p) {
    const group = new THREE.Group();
    const y = terrainHeight(p.x, p.z) + GRID.curb;
    const tex = textTexture(p.text, { bg: '#11402c' });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.05, 0.08), [
      this.materials.darkMetal,
      this.materials.darkMetal,
      this.materials.darkMetal,
      this.materials.darkMetal,
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.15 }),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }),
    ]);
    panel.position.y = 2.6;
    panel.castShadow = true;
    const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1), this.materials.darkMetal);
    post1.position.set(-1.8, 1.05, 0);
    const post2 = post1.clone();
    post2.position.x = 1.8;
    group.add(panel, post1, post2);
    group.position.set(p.x, y, p.z);
    group.rotation.y = p.rot ?? 0;
    this.root.add(group);
  }

  _fountain(p) {
    const y = terrainHeight(p.x, p.z) + GRID.curb;
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.7, 32, 1, true), this.materials.concrete);
    basin.position.set(p.x, y + 0.35, p.z);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.25, 0.18, 8, 40).rotateX(Math.PI / 2), this.materials.white);
    rim.position.set(p.x, y + 0.7, p.z);
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.1, 32).rotateX(-Math.PI / 2), this.materials.water);
    water.position.set(p.x, y + 0.55, p.z);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 2.2, 12), this.materials.white);
    column.position.set(p.x, y + 1.1, p.z);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.3, 0.4, 20), this.materials.white);
    bowl.position.set(p.x, y + 2.3, p.z);
    for (const o of [basin, rim, column, bowl]) {
      o.castShadow = o.receiveShadow = true;
    }
    this.root.add(basin, rim, water, column, bowl);
  }

  _kiosk(p) {
    const y = terrainHeight(p.x, p.z) + GRID.curb;
    const g = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6), this.materials.white);
      col.position.set(Math.cos(a) * 1.4, 1.3, Math.sin(a) * 1.4);
      g.add(col);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.2, 6), this.materials.tiles);
    roof.position.y = 3.2;
    roof.castShadow = true;
    const counter = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1, 6), new THREE.MeshStandardMaterial({ color: 0xd9c27a, roughness: 0.6 }));
    counter.position.y = 0.5;
    g.add(roof, counter);
    g.position.set(p.x, y, p.z);
    this.root.add(g);
  }

  _goal(p) {
    const y = terrainHeight(p.x, p.z) + GRID.curb;
    const g = new THREE.Group();
    const mat = this.materials.white;
    const post = new THREE.CylinderGeometry(0.06, 0.06, 2.1);
    for (const x of [-2.5, 2.5]) {
      const m = new THREE.Mesh(post, mat);
      m.position.set(x, 1.05, 0);
      g.add(m);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5).rotateZ(Math.PI / 2), mat);
    bar.position.y = 2.1;
    g.add(bar);
    g.position.set(p.x, y, p.z);
    g.rotation.y = p.rot;
    g.traverse((o) => (o.castShadow = true));
    this.root.add(g);
  }

  _fence(p) {
    const y = terrainHeight(p.x, p.z) + GRID.curb;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = '#9aa1a6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(64, 64);
    ctx.moveTo(64, 0);
    ctx.lineTo(0, 64);
    ctx.stroke();
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(p.d / 0.5, p.h / 0.5);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.d, p.h), new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 }));
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(p.x, y + p.h / 2, p.z);
    mesh.castShadow = true;
    this.root.add(mesh);
  }

  _field(p) {
    const g = new GeoBuilder();
    g.heightGrid(p.x - p.w / 2, p.z - p.d / 2, p.x + p.w / 2, p.z + p.d / 2, 3, (x, z) => terrainHeight(x, z) + GRID.curb + 0.03, 1, [1, 1, 1], (x, z) => [(x - p.x + p.w / 2) / p.w, (z - p.z + p.d / 2) / p.d]);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3c7a2c';
    ctx.fillRect(0, 0, 256, 512);
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = k % 2 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, k * 64, 256, 64);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, 240, 496);
    ctx.beginPath();
    ctx.moveTo(8, 256);
    ctx.lineTo(248, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(128, 256, 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeRect(68, 8, 120, 60);
    ctx.strokeRect(68, 444, 120, 60);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = this._mesh(g.build(), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }), { cast: false });
    m.name = 'cancha';
  }

  _orquideorama(p) {
    // Estructura de "flores" hexagonales de madera, como en el Botánico.
    const y = terrainHeight(p.x, p.z) + GRID.curb;
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.7 });
    const R = 7;
    const centers = [[0, 0], [1.5 * R, R * 0.87], [1.5 * R, -R * 0.87], [0, 1.74 * R], [-1.5 * R, R * 0.87], [-1.5 * R, -R * 0.87], [0, -1.74 * R]];
    for (const [cx, cz] of centers) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.92, 0.7, 6, 1), wood);
      cap.position.set(cx, 14, cz);
      cap.rotation.y = Math.PI / 6;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, 0.9, 13.6, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a5c33, roughness: 0.75, side: THREE.DoubleSide, wireframe: false }));
      trunk.position.set(cx, 6.8, cz);
      g.add(cap, trunk);
    }
    g.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    g.position.set(p.x, y, p.z);
    this.root.add(g);
    // Columnas centrales como colisiones.
    for (const [cx, cz] of centers) {
      this.city.collision.add({ minX: p.x + cx - 0.9, maxX: p.x + cx + 0.9, minZ: p.z + cz - 0.9, maxZ: p.z + cz + 0.9, minY: y - 1, maxY: y + 14, kind: 'orquideorama' });
    }
  }

  _pond(p) {
    const y = terrainHeight(p.x, p.z) + GRID.curb + 0.05;
    const w = new THREE.Mesh(new THREE.CircleGeometry(p.r, 40).rotateX(-Math.PI / 2), this.materials.water);
    w.position.set(p.x, y, p.z);
    w.receiveShadow = true;
    this.root.add(w);
  }

  _parking(p) {
    const pts = [];
    for (let x = p.x - p.w / 2 + 2; x < p.x + p.w / 2; x += 5.5) {
      for (const zz of [p.z - p.d / 2 + 4, p.z + p.d / 2 - 4]) {
        const y = terrainHeight(x, zz) + GRID.curb + 0.04;
        pts.push(x, y, zz - 3, x, y, zz + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf0f0f0 })));
  }

  _railing(p) {
    const y = terrainHeight(p.x, p.z) + GRID.curb;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 26), this.materials.darkMetal);
    bar.position.set(p.x - p.w / 2, y + 1.05, p.z);
    this.root.add(bar);
  }

  _tombs(tombs) {
    if (!tombs.length) return;
    const base = new THREE.BoxGeometry(1.4, 0.6, 2.6);
    base.translate(0, 0.3, 0);
    const head = new THREE.BoxGeometry(1.3, 1.2, 0.2);
    head.translate(0, 0.9, -1.2);
    const cross = new THREE.BoxGeometry(0.12, 0.8, 0.12);
    cross.translate(0, 1.9, -1.2);
    const arm = new THREE.BoxGeometry(0.5, 0.12, 0.12);
    arm.translate(0, 2.05, -1.2);
    const im = new THREE.InstancedMesh(mergeGeos([base, head, cross, arm]), new THREE.MeshStandardMaterial({ color: 0xe7e4dd, roughness: 0.3 }), tombs.length);
    const m = new THREE.Matrix4();
    tombs.forEach((t, i) => {
      m.makeTranslation(t.x, terrainHeight(t.x, t.z) + GRID.curb, t.z);
      im.setMatrixAt(i, m);
    });
    im.castShadow = im.receiveShadow = true;
    this.root.add(im);
  }

  _flowers(gardens) {
    // Arbustos floridos (heliconias, san joaquines) en jardines.
    const rng = makeRng(31);
    const items = [];
    for (const g of gardens) {
      for (let k = 0; k < (g.flowers ? 160 : 220); k++) {
        const x = g.x + rng.range(-g.w / 2 + 3, g.w / 2 - 3);
        const z = g.z + rng.range(-g.d / 2 + 3, g.d / 2 - 3);
        items.push({ x, z, s: rng.range(0.5, 1.2), c: rng.pick([[0.85, 0.2, 0.2], [0.95, 0.6, 0.1], [0.9, 0.3, 0.6], [0.25, 0.45, 0.18], [0.3, 0.5, 0.2], [0.95, 0.9, 0.3]]) });
      }
    }
    const geo = new THREE.IcosahedronGeometry(0.6, 1);
    geo.scale(1, 0.7, 1);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), items.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      m.makeScale(it.s, it.s, it.s).setPosition(it.x, terrainHeight(it.x, it.z) + GRID.curb + 0.2 * it.s, it.z);
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.setRGB(...it.c));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    this.root.add(im);
  }

  // ---------------------------------------------------------------- metro
  _metro() {
    const mt = this.city.metro;
    if (!mt) return;
    const conc = new THREE.MeshStandardMaterial({ color: 0xbdbab3, roughness: 0.85, map: this.tex.concrete.map, normalMap: this.tex.concrete.normalMap });
    const len = mt.z1 - mt.z0;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 1.8, len), conc);
    deck.position.set(mt.x, mt.deckY - 0.9, (mt.z0 + mt.z1) / 2);
    deck.castShadow = deck.receiveShadow = true;
    this.root.add(deck);
    // Barandas del viaducto.
    for (const dx of [-4.4, 4.4]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, len), conc);
      w.position.set(mt.x + dx, mt.deckY + 0.5, (mt.z0 + mt.z1) / 2);
      this.root.add(w);
    }
    // Rieles.
    for (const dx of [-2.4, -1.0, 1.0, 2.4]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, len), this.materials.darkMetal);
      r.position.set(mt.x + dx, mt.deckY + 0.08, (mt.z0 + mt.z1) / 2);
      this.root.add(r);
    }
    // Pilas.
    const pillars = this.city.props.filter((p) => p.type === 'metroPillar');
    const pgeo = new THREE.CylinderGeometry(0.9, 1.1, 1, 12);
    pgeo.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(pgeo, conc, pillars.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    pillars.forEach((p, i) => {
      const y = terrainHeight(p.x, p.z) - 0.5;
      m.compose(v.set(p.x, y, p.z), q, s.set(1, p.top - 1.8 - y, 1));
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    this.root.add(im);
    // Estación Universidad: plataformas, cubierta y letrero.
    const st = new THREE.Group();
    const plat = new THREE.Mesh(new THREE.BoxGeometry(18, 1.2, mt.stationLength), conc);
    plat.position.set(0, -0.6, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(20, 0.4, mt.stationLength + 6), new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.5, metalness: 0.3 }));
    roof.position.y = 6.5;
    st.add(plat, roof);
    for (const dz of [-30, -10, 10, 30]) {
      for (const dx of [-8.5, 8.5]) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6.5), this.materials.darkMetal);
        c.position.set(dx, 3.25, dz);
        st.add(c);
      }
    }
    const signTex = textTexture('UNIVERSIDAD', { bg: '#0b5d3b', w: 1024, h: 200 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2), new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.3 }));
    sign.position.set(10.1, 5, 0);
    sign.rotation.y = Math.PI / 2;
    const logo = textTexture('METRO  ·  Línea A', { bg: '#0b5d3b', w: 1024, h: 200 });
    const lg = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.8), new THREE.MeshStandardMaterial({ map: logo }));
    lg.position.set(10.1, 1.2, 0);
    lg.rotation.y = Math.PI / 2;
    st.add(sign, lg);
    st.position.set(mt.x, mt.deckY, mt.stationZ);
    st.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.root.add(st);
    // Tren de 3 vagones.
    this.train = new THREE.Group();
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xe9ecee, roughness: 0.25, metalness: 0.5, clearcoat: 0.5 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x0f7a45 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x1a232b, roughness: 0.05, metalness: 0.2 });
    for (let k = 0; k < 3; k++) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3.2, 21), bodyMat);
      body.position.y = 2.0;
      const win = new THREE.Mesh(new THREE.BoxGeometry(2.95, 1.1, 19), glass);
      win.position.y = 2.5;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.96, 0.35, 21), stripeMat);
      stripe.position.y = 1.2;
      car.add(body, win, stripe);
      car.position.z = (k - 1) * 21.6;
      this.train.add(car);
    }
    this.train.traverse((o) => (o.castShadow = true));
    this.train.position.set(mt.x - 1.7, mt.deckY, mt.z0);
    this.root.add(this.train);
    this.trainState = { z: mt.z0, dir: 1, wait: 0, speed: 0 };
  }

  update(dt, nightFactor) {
    for (const { m, max } of this.nightMaterials) m.emissiveIntensity = max * nightFactor;
    if (this.lampGlow) this.lampGlow.opacity = 0.55 * nightFactor;
    if (this.cityLights) this.cityLights.material.opacity = Math.min(1, nightFactor * 1.3);
    // Tren: acelera, frena en la estación Universidad y se devuelve al final.
    const mt = this.city.metro;
    const ts = this.trainState;
    if (!ts) return;
    if (ts.wait > 0) {
      ts.wait -= dt;
      return;
    }
    const maxV = 16;
    const target = ts.dir > 0 ? (ts.z < mt.stationZ - 1 ? mt.stationZ : mt.z1) : ts.z > mt.stationZ + 1 ? mt.stationZ : mt.z0;
    const dist = Math.abs(target - ts.z);
    const desired = Math.min(maxV, Math.sqrt(2 * 1.2 * dist));
    ts.speed += Math.sign(desired - ts.speed) * Math.min(Math.abs(desired - ts.speed), 1.5 * dt);
    ts.z += ts.dir * ts.speed * dt;
    if (dist < 0.3) {
      ts.z = target;
      ts.speed = 0;
      ts.wait = target === mt.stationZ ? 12 : 4;
      if (target !== mt.stationZ) {
        ts.dir *= -1;
        this.train.position.x = mt.x + (ts.dir > 0 ? -1.7 : 1.7);
      }
    }
    this.train.position.z = ts.z;
  }
}

let _glow = null;
export function glowSprite() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}

/** Fusiona geometrías simples (mismos atributos position/normal/uv). */
export function mergeGeos(geos) {
  const out = new GeoBuilder();
  for (const g of geos) {
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const uv = g.attributes.uv;
    const base = out.vertexCount;
    for (let i = 0; i < pos.count; i++) {
      out.vertex(pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i), uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) out.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < pos.count; i++) out.idx.push(base + i);
  }
  const geo = out.build();
  geo.deleteAttribute('color');
  return geo;
}
