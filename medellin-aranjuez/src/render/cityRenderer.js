// Construye la escena 3D del barrio a partir del layout de la simulación.

import * as THREE from 'three';
import { GeoBuilder } from './geoBuilder.js';
import { buildModelProps, updatePropLod } from './props.js';
import { FacadeBuilder } from './facadeBuilder.js';
import { buildStreetFurniture } from './streetFurniture.js';
import { facadeLayout } from '../sim/facades.js';
import { textTexture } from './textures.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { facadeMaterial, hasPhotoTextures, photoMaterial } from './photoMaterials.js';
import { GEO_REF, riverX, urbanAmount } from '../sim/geography.js';
import { albedoAt } from './horizon.js';
import { makeRng } from '../sim/rng.js';
import { GRID, MAPA, MAP_MAX_X, MAP_MAX_Z, MAP_MIN_X, MAP_MIN_Z, RIVER, backdropHeight, terrainHeight } from '../sim/terrain.js';
import { faceFrame } from '../sim/facades.js';
import { pointAlong, pointInPoly, polyArea } from '../sim/geom2d.js';
import { densify, drapePolygon, drapeTris, orientedQuad, polylineFrames, polyWall, ribbon } from './drape.js';
import { buildRoof, roofParapet } from './roofs.js';
import { buildMetro } from './metro.js';

const FACADE_M = 12; // metros que cubre una textura de fachada

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
    this.lodChunks = []; // utilería con nivel de detalle por instancia (props.js)
    this.lampGlow = null;
    this.cityLights = null;
    this.materials = this._materials();
    this.facades = new FacadeBuilder(this);
    this._terrain();
    this._backdrop();
    this._roads();
    this._blocks();
    this._water();
    this._buildings();
    this._props();
    this.metro = buildMetro(this);
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
    // Texturas fotográficas (Poly Haven, CC0) si están disponibles.
    this.photo = hasPhotoTextures();
    const photoFacade = (id, layers) => {
      const m = facadeMaterial(id, layers);
      this.nightMaterials.push({ m, max: 1.4 });
      return m;
    };
    const P = (id, opts) => (this.photo ? photoMaterial(id, opts) : null);
    const roadOpts = { extra: { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } };
    const towerMat = this.photo ? photoFacade('painted_plaster_wall', t.facadeTower) : facade([t.tower], 0.6)[0];
    const photoMats = this.photo
      ? {
          brick: [photoFacade('red_brick', t.facadeBrick[0]), photoFacade('large_red_bricks', t.facadeBrick[1])],
          stucco: [photoFacade('painted_plaster_wall', t.facadeStucco[0]), photoFacade('beige_wall_001', t.facadeStucco[1])],
          concrete: P('concrete_wall_008', { uvMeters: 3, vertexColors: true }),
          roof: P('concrete_floor_02', { uvMeters: 6 }),
          tiles: P('clay_roof_tiles_02', { uvMeters: 3, normalScale: 1.4, vertexColors: true, extra: { side: THREE.DoubleSide } }),
          zinc: P('corrugated_iron_02', { uvMeters: 3, vertexColors: true, extra: { metalness: 0.4, side: THREE.DoubleSide } }),
          stone: P('concrete_wall_008', { uvMeters: 2, vertexColors: true }),
          metal: P('corrugated_iron_02', { uvMeters: 3, extra: { metalness: 0.45 } }),
          plain: P('painted_plaster_wall', { uvMeters: 4, vertexColors: true }),
          asphalt: P('asphalt_02', { uvMeters: 9, ...roadOpts }),
          asphaltPlain: P('asphalt_02', { uvMeters: 9, ...roadOpts }),
          sidewalk: P('grey_tiles', { uvMeters: 4 }),
          pavers: P('herringbone_brick', { uvMeters: 4 }),
          grass: P('leafy_grass', { uvMeters: 10, color: 0xa9d98a }),
          dryGrass: P('leafy_grass', { uvMeters: 10, color: 0xc9d08e }),
          terrain: P('leafy_grass', { uvMeters: 8, vertexColors: true }),
        }
      : {};
    const mats = {
      brick: facade(t.brick),
      stucco: facade(t.stucco),
      tower: towerMat,
      mural: t.mural.map((m) => std({ map: m, roughness: 0.85, vertexColors: true })),
      concrete: std({ map: t.concrete.map, normalMap: t.concrete.normalMap, roughness: 0.95, vertexColors: true }),
      roof: std({ map: t.roof.map, normalMap: t.roof.normalMap, roughness: 0.97 }),
      tiles: std({ map: t.tiles.map, normalMap: t.tiles.normalMap, roughness: 0.8, vertexColors: true, side: THREE.DoubleSide }),
      zinc: std({ map: t.metal.map, normalMap: t.metal.normalMap, roughness: 0.5, metalness: 0.45, vertexColors: true, side: THREE.DoubleSide }),
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
      // Barrotes de balcón: un solo plano con recorte alfa (2 triángulos por
      // baranda en vez de ~200 de cajitas).
      railingBars: std({ color: 0x23262a, roughness: 0.5, metalness: 0.7, alphaMap: barsTexture(), alphaTest: 0.5, side: THREE.DoubleSide }),
      white: std({ color: 0xf2f2ee, roughness: 0.4 }),
      ...photoMats,
    };
    // Culatas y cuartos de azotea: repello pintado con el color de la casa.
    mats.gable = mats.plain;
    return mats;
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
    // Casi todo el terreno del mapa queda bajo andenes, patios y prados: basta una rejilla gruesa.
    const step = 4;
    const rng = makeRng(3);
    const x0 = MAP_MIN_X - pad;
    const x1 = MAP_MAX_X + pad;
    const z0 = MAP_MIN_Z - pad;
    const z1 = MAP_MAX_Z + pad;
    // Rejilla por franjas para no crear un solo arreglo gigantesco.
    const col = [0.9, 0.95, 0.85];
    // Fuera del área jugable sigue el mismo suelo que el fondo (backdropHeight):
    // así las casas lejanas no quedan enterradas bajo la ladera del mapa.
    g.heightGrid(x0, z0, x1, z1, step, terrainHeight, 8, col);
    // Variación de color (tierra seca / pasto) por vértice.
    for (let i = 0; i < g.col.length; i += 3) {
      const x = g.pos[i];
      const z = g.pos[i + 2];
      const n = 0.5 + 0.5 * Math.sin(x * 0.05 + z * 0.03) * Math.cos(z * 0.07 - x * 0.02);
      const k = 0.75 + 0.3 * n + rng.range(-0.04, 0.04);
      // Fuera del área jugable el suelo es de ciudad (calles, patios), no potrero.
      const out = Math.max(0, MAP_MIN_X - 25 - x, x - MAP_MAX_X - 25, MAP_MIN_Z - 25 - z, z - MAP_MAX_Z - 25);
      const u = Math.min(1, out / 30);
      // Prado verde de Medellín con manchas más secas.
      const dry = (1 - n) * 0.35;
      g.col[i] = k * (0.64 + dry * 0.4) * (1 - u) + 0.3 * u;
      g.col[i + 1] = k * (0.84 - dry * 0.1) * (1 - u) + 0.28 * u;
      g.col[i + 2] = k * (0.5 + dry * 0.1) * (1 - u) + 0.28 * u;
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
    // Zona urbana en la parte baja de las laderas, verde arriba (misma regla que el horizonte).
    const urban = (x, z) => urbanAmount(x, z, backdropHeight(x, z) + GEO_REF);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let y = backdropHeight(x, z);
      if (x > inner.minX && x < inner.maxX && z > inner.minZ && z < inner.maxZ) y -= 8;
      pos.setY(i, y);
      const u = urban(x, z);
      // Misma paleta que el horizonte: ladrillo y teja en lo urbano, monte arriba.
      const c = albedoAt(x, z, y + GEO_REF, u, 0.25, () => 0.5);
      // Entre las casas, lo urbano visto de lejos es calle, andén y techo gris.
      const g = u * 0.55;
      colors[i * 3] = c[0] * (1 - g) + 0.12 * g;
      colors[i * 3 + 1] = c[1] * (1 - g) + 0.11 * g;
      colors[i * 3 + 2] = c[2] * (1 - g) + 0.1 * g;
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
    const nearShare = 0.55;
    while (n < count && tries < count * 8) {
      tries++;
      // Más de la mitad de las casas, en un anillo denso alrededor del mapa:
      // los barrios vecinos (Moravia, Berlín, Campo Valdés, Manrique) son
      // ciudad continua, con la misma cuadrícula de calles.
      const near = n < count * nearShare;
      let x;
      let z;
      if (near) {
        // Franja de 600 m alrededor del mapa: los barrios vecinos siguen.
        x = rng.range(inner.minX - 600, inner.maxX + 600);
        z = rng.range(inner.minZ - 600, inner.maxZ + 600);
      } else {
        x = rng.range(-2400, 2400);
        z = rng.range(-2400, 2400);
      }
      // Desde 10 m más allá del límite jugable: el barrio no termina en un potrero.
      if (x > inner.minX + 60 && x < inner.maxX - 60 && z > inner.minZ + 60 && z < inner.maxZ - 60) continue;
      // Río: franja sin casas.
      if (Math.abs(x - riverX(z)) < 45) continue;
      if (urban(x, z) < rng.next()) continue;
      const y = backdropHeight(x, z);
      const w = rng.range(7, 13);
      const h = rng.range(5, 12) * (rng.chance(0.06) ? 3 : 1);
      p.set(x, y - 1, z);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, near || rng.chance(0.5) ? 0 : 0.3);
      s.set(w, h, rng.range(8, 14));
      m.compose(p, q, s);
      houses.setMatrixAt(n, m);
      const r = rng.next();
      // Ladrillo a la vista (la mayoría), repello claro y algo de pintura gastada.
      if (r < 0.66) c.setRGB(0.5 + rng.range(-0.08, 0.06), 0.27 + rng.range(-0.03, 0.03), 0.18);
      else if (r < 0.9) c.setRGB(0.72, 0.7, 0.66);
      else c.setHSL(rng.next(), 0.18, 0.5);
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

    // Río Medellín: sigue su cauce real (gira un poco al norte).
    const rg = new GeoBuilder();
    for (let z = -2600; z < 2600; z += 40) {
      // Dentro del mapa el río real lo dibuja _water().
      if (z > inner.minZ - 40 && z < inner.maxZ) continue;
      const a0 = riverX(z);
      const a1 = riverX(z + 40);
      const y0 = backdropHeight(a0, z) + 1.2;
      const y1 = backdropHeight(a1, z + 40) + 1.2;
      const v0 = z / 46;
      const v1 = (z + 40) / 46;
      rg.quad([a0 - 23, y0, z], [a1 - 23, y1, z + 40], [a1 + 23, y1, z + 40], [a0 + 23, y0, z], [0, 1, 0], [[0, v0], [0, v1], [1, v1], [1, v0]]);
    }
    const river = new THREE.Mesh(rg.build(), this.materials.water);
    river.name = 'rio';
    river.receiveShadow = false;
    this.root.add(river);
  }

  // ---------------------------------------------------------------- vías
  /** Radio de la "plaza" de asfalto de cada intersección. */
  _nodeRadius(n) {
    let r = 0;
    for (const l of n.links) r = Math.max(r, this.city.edges[l.edge].width / 2);
    return r;
  }

  _roads() {
    const g = new GeoBuilder();
    const lift = 0.03;
    const hf = (x, z) => terrainHeight(x, z) + lift;
    // UV del mundo: los tramos que se traslapan en los cruces se ven iguales.
    const uv = (s, o, x, z) => [x / 9, -z / 9];
    const all = [...this.city.edges, ...this.city.paths.filter((p) => p.cls !== 'footway')];
    for (const e of all) {
      const hw = e.width / 2;
      ribbon(g, e.pts, -hw, hw, hf, { step: 3, across: Math.max(1, Math.ceil(e.width / 4)), uv });
    }
    // Intersecciones: disco de asfalto que tapa las uniones.
    const gi = new GeoBuilder();
    for (const n of this.city.nodes) {
      if (n.links.length < 2) continue;
      const r = this._nodeRadius(n) * 1.08;
      const k = 14;
      const tris = [];
      for (let i = 0; i < k; i++) {
        const a0 = (i / k) * Math.PI * 2;
        const a1 = ((i + 1) / k) * Math.PI * 2;
        tris.push([[n.x, n.z], [n.x + Math.cos(a0) * r, n.z + Math.sin(a0) * r], [n.x + Math.cos(a1) * r, n.z + Math.sin(a1) * r]]);
      }
      drapeTris(gi, tris, (x, z) => terrainHeight(x, z) + lift + 0.004, { step: 3, uv: (x, z) => [x / 9, -z / 9] });
    }
    this._mesh(g.build(), this.materials.asphalt, { cast: false, name: 'vias' });
    this._mesh(gi.build(), this.materials.asphaltPlain, { cast: false, name: 'intersecciones' });
    if (this.photo) this._roadMarkings();
  }

  /** Línea central amarilla, bordes y carriles blancos y cebras en los cruces. */
  _roadMarkings() {
    const yellow = new GeoBuilder();
    const white = new GeoBuilder();
    const hf = (x, z) => terrainHeight(x, z) + 0.05;
    // Franja pintada a lo largo de la arista entre s0 y s1 a distancia lateral `off`.
    const strip = (gb, e, s0, s1, off, w) => {
      if (s1 - s0 < 0.2) return;
      const pts = [];
      const n = Math.max(1, Math.ceil((s1 - s0) / 2.5));
      for (let k = 0; k <= n; k++) {
        const p = pointAlong(e.pts, e.cum, s0 + ((s1 - s0) * k) / n);
        pts.push([p.x - p.dz * off, p.z + p.dx * off]);
      }
      ribbon(gb, pts, -w / 2, w / 2, hf, { step: 3, uv: (s, o) => [o, s] });
    };
    for (const e of this.city.edges) {
      if (e.cls === 'service' || e.length < 8) continue;
      const na = this.city.nodes[e.a];
      const nb = this.city.nodes[e.b];
      const start = (na.links.length > 1 ? this._nodeRadius(na) : 0) + 1.5;
      const end = e.length - (nb.links.length > 1 ? this._nodeRadius(nb) : 0) - 1.5;
      if (end - start < 4) continue;
      const hw = e.width / 2;
      const lanes = Math.max(1, e.lanes || 2);
      if (!e.oneway && e.width >= 6) {
        // Línea central discontinua (3 m pintado, 3 m libre); continua en vías grandes.
        if (e.width >= 9) strip(yellow, e, start, end, 0, 0.14);
        else for (let t = start + 1; t < end - 1; t += 6) strip(yellow, e, t, Math.min(t + 3, end - 1), 0, 0.14);
      } else if (e.oneway && lanes >= 2) {
        for (let k = 1; k < lanes; k++) {
          const off = -hw + (e.width * k) / lanes;
          for (let t = start + 1; t < end - 1; t += 8) strip(white, e, t, Math.min(t + 3, end - 1), off, 0.12);
        }
      }
      // Bordes continuos en las vías principales.
      if (e.width >= 8) for (const off of [-hw + 0.35, hw - 0.35]) strip(white, e, start, end, off, 0.12);
      // Cebras en los extremos que llegan a un cruce.
      if (e.cls.startsWith('trunk')) continue;
      for (const [nd, c0, dir] of [
        [na, start - 1.2, 1],
        [nb, end + 1.2, -1],
      ]) {
        if (nd.links.length < 3) continue;
        const a = dir > 0 ? c0 : c0 - 2.6;
        for (let off = -hw + 0.6; off <= hw - 0.5; off += 1.15) strip(white, e, a, a + 2.6, off, 0.55);
      }
    }
    const paint = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this._mesh(yellow.build(), paint(0xe0b12a), { cast: false, name: 'linea-central' });
    this._mesh(white.build(), paint(0xe8e8e2), { cast: false, name: 'demarcacion' });
  }

  // ---------------------------------------------------------------- manzanas
  _blocks() {
    const walk = new GeoBuilder();
    const lots = new GeoBuilder();
    const green = new GeoBuilder();
    const curb = new GeoBuilder();
    const hf = (x, z) => terrainHeight(x, z) + GRID.curb;
    const hLot = (x, z) => terrainHeight(x, z) + GRID.curb + 0.01;
    // Área construida por manzana: los lotes casi vacíos son solares con prado
    // y matas (en Medellín todo lo que no se pavimenta se vuelve verde).
    const built = new Map();
    for (const h of this.city.buildings) built.set(h.block, (built.get(h.block) ?? 0) + 4 * h.frame.hu * h.frame.hv);
    const greenAreas = this.city.areas.filter((a) => ['verde', 'parque', 'colegio', 'salud', 'cancha'].includes(a.kind));
    for (const b of this.city.blocks) {
      const out = polyArea(b.curb) > 0 ? -1 : 1;
      polyWall(curb, b.curb, out, (x, z) => terrainHeight(x, z) - 0.08, hf, { step: 3, uvScale: 2, color: [0.85, 0.83, 0.8] });
      if (b.type !== 'residencial') {
        // Separadores y orillas del río: prado.
        drapePolygon(green, b.curb, hf, { step: 5, uv: (x, z) => [x / 10, -z / 10] });
        continue;
      }
      // Andén: el contorno menos los lotes; los lotes son patios de concreto.
      drapePolygon(walk, b.curb, hf, { step: 4, uv: (x, z) => [x / 4, -z / 4] }, b.lots);
      const lotArea = b.lots.reduce((acc, l) => acc + Math.abs(polyArea(l)), 0);
      const coverage = (built.get(b.id) ?? 0) / Math.max(1, lotArea);
      for (const l of b.lots) {
        const [cx, cz] = l[Math.floor(l.length / 2)];
        const isGreen = coverage < 0.35 || greenAreas.some((a) => a.block === b && pointInPoly(cx, cz, a.poly));
        if (isGreen) drapePolygon(green, l, hLot, { step: 5, uv: (x, z) => [x / 10, -z / 10] });
        else drapePolygon(lots, l, hLot, { step: 5, uv: (x, z) => [x / 3, -z / 3], color: [0.8, 0.78, 0.74] });
      }
    }
    this._mesh(walk.build(), this.materials.sidewalk, { cast: false, name: 'andenes' });
    this._mesh(lots.build(), this.materials.concrete, { cast: false, name: 'patios' });
    this._mesh(green.build(), this.materials.grass, { cast: false, name: 'prados' });
    this._mesh(curb.build(), this.materials.concrete, { cast: false, name: 'sardineles' });
  }

  /** Zonas especiales del mapa: plaza del parque, jardines y canchas. */
  _areas(byType) {
    const hf = (lift) => (x, z) => terrainHeight(x, z) + GRID.curb + lift;
    const plaza = new GeoBuilder();
    for (const p of byType.plazaPoly ?? []) drapePolygon(plaza, p.poly, hf(0.02), { step: 4, uv: (x, z) => [x / 4, -z / 4] });
    this._mesh(plaza.build(), this.materials.pavers, { cast: false, name: 'plaza' });
    const garden = new GeoBuilder();
    for (const p of byType.garden ?? []) if (p.poly) drapePolygon(garden, p.poly, hf(0.03), { step: 4, uv: (x, z) => [x / 10, -z / 10] });
    this._mesh(garden.build(), this.materials.grass, { cast: false, name: 'jardines' });
    for (const p of byType.fieldPoly ?? []) this._fieldPoly(p);
  }

  _fieldPoly(p) {
    // Superficie: prado (o placa de concreto) en todo el lote y la cancha marcada encima.
    const hf = (lift) => (x, z) => terrainHeight(x, z) + GRID.curb + lift;
    if (p.poly) {
      const g = new GeoBuilder();
      drapePolygon(g, p.poly, hf(0.02), { step: 4, uv: (x, z) => [x / 10, -z / 10] });
      this._mesh(g.build(), p.placa ? this.materials.concrete : this.materials.dryGrass, { cast: false });
    }
    const f = p.frame;
    if (!f) return;
    const g = new GeoBuilder();
    const L = Math.max(f.hu, f.hv);
    const long = f.hu >= f.hv;
    const tris = [
      [[f.x - f.ux * f.hu - f.nx * f.hv, f.z - f.uz * f.hu - f.nz * f.hv], [f.x + f.ux * f.hu - f.nx * f.hv, f.z + f.uz * f.hu - f.nz * f.hv], [f.x + f.ux * f.hu + f.nx * f.hv, f.z + f.uz * f.hu + f.nz * f.hv]],
      [[f.x - f.ux * f.hu - f.nx * f.hv, f.z - f.uz * f.hu - f.nz * f.hv], [f.x + f.ux * f.hu + f.nx * f.hv, f.z + f.uz * f.hu + f.nz * f.hv], [f.x - f.ux * f.hu + f.nx * f.hv, f.z - f.uz * f.hu + f.nz * f.hv]],
    ];
    // UV: la textura de la cancha (vertical en el lienzo) va a lo largo del lado largo.
    const uv = (x, z) => {
      const u = ((x - f.x) * f.ux + (z - f.z) * f.uz) / f.hu;
      const v = ((x - f.x) * f.nx + (z - f.z) * f.nz) / f.hv;
      return long ? [(v + 1) / 2, (u + 1) / 2] : [(u + 1) / 2, (v + 1) / 2];
    };
    drapeTris(g, tris, hf(0.04), { step: 3, uv });
    const tex = fieldTexture(p.placa);
    const m = this._mesh(g.build(), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { cast: false });
    m.name = 'cancha';
    void L;
  }

  // ---------------------------------------------------------------- agua
  _water() {
    const water = new GeoBuilder();
    const bank = new GeoBuilder();
    const stone = new GeoBuilder();
    if (RIVER.pts.length > 1) {
      // Canal del río Medellín: taludes de concreto y lámina de agua (terreno.js cava el cauce).
      const hw = RIVER.half;
      ribbon(water, RIVER.pts, -hw - 1, hw + 1, (x, z) => backdropHeight(x, z) - RIVER.depth + 1.3, { step: 6, across: 4, uv: (s, o) => [o / 12, s / 12] });
      for (const sgn of [-1, 1]) {
        const o0 = sgn > 0 ? hw - 0.5 : -hw - RIVER.bank - 0.3;
        const o1 = sgn > 0 ? hw + RIVER.bank + 0.3 : -hw + 0.5;
        ribbon(bank, RIVER.pts, o0, o1, (x, z) => terrainHeight(x, z) + 0.22, { step: 5, across: 3, uv: (s, o) => [o / 3, s / 3], color: [0.78, 0.76, 0.72] });
      }
    }
    // Quebradas a cielo abierto: cauce angosto entre muros de piedra.
    for (const w of this.city.water) {
      if (/Medell/i.test(w.name)) continue;
      const hw = w.kind === 'canal' ? 2.6 : 1.5;
      ribbon(water, w.pts, -hw, hw, (x, z) => terrainHeight(x, z) + 0.2, { step: 3, uv: (s, o) => [o / 6, s / 6] });
      for (const sgn of [-1, 1]) {
        const o = sgn * (hw + 0.2);
        const pts = w.pts;
        // Muro: dos caras verticales y el remate.
        for (const [a, b] of [
          [o - 0.2, o - 0.2],
          [o + 0.2, o + 0.2],
        ]) {
          void b;
          const P = [];
          for (const q of densify(pts, 3)) P.push(q);
          const F = polylineFrames(P);
          for (let i = 0; i < P.length - 1; i++) {
            const x0 = P[i][0] + F[i].nx * a * F[i].miter;
            const z0 = P[i][1] + F[i].nz * a * F[i].miter;
            const x1 = P[i + 1][0] + F[i + 1].nx * a * F[i + 1].miter;
            const z1 = P[i + 1][1] + F[i + 1].nz * a * F[i + 1].miter;
            const nrm = [F[i].nx * Math.sign(a - o + 1e-9 * sgn), 0, F[i].nz * Math.sign(a - o + 1e-9 * sgn)];
            const y0 = terrainHeight(x0, z0);
            const y1 = terrainHeight(x1, z1);
            orientedQuad(stone, [[x0, y0 - 0.1, z0], [x1, y1 - 0.1, z1], [x1, y1 + 0.8, z1], [x0, y0 + 0.8, z0]], nrm, [[i * 1.5, 0], [(i + 1) * 1.5, 0], [(i + 1) * 1.5, 0.45], [i * 1.5, 0.45]]);
          }
        }
        ribbon(stone, pts, o - 0.2, o + 0.2, (x, z) => terrainHeight(x, z) + 0.8, { step: 3, uv: (s, q) => [q, s / 2] });
      }
    }
    this._mesh(water.build(), this.materials.water, { cast: false, name: 'agua' }).receiveShadow = false;
    this._mesh(bank.build(), this.materials.concrete, { cast: false, name: 'orillas' });
    this._mesh(stone.build(), this.materials.stone ?? this.materials.concrete, { name: 'muros-quebrada' });
  }

  // ---------------------------------------------------------------- edificios
  _buildings() {
    const groups = new Map();
    const get = (key) => {
      if (!groups.has(key)) groups.set(key, new GeoBuilder());
      return groups.get(key);
    };
    const concrete = get('concrete');
    const out = { tanks: [], rebar: [] };
    const rng = makeRng(123);
    const murals = [];

    for (let bi = 0; bi < this.city.buildings.length; bi++) {
      const b = this.city.buildings[bi];
      const { groundY, topY, baseY } = b;
      // Casas del barrio: fachada modelada (facadeBuilder); el resto, caja texturizada.
      const layout = facadeLayout(b, bi);
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
        case 'institucional':
        case 'iglesia':
          matKey = `stucco${rng.int(0, 1)}`;
          break;
        case 'museo':
          matKey = 'mural0';
          color = [1, 1, 1];
          break;
        case 'taller':
          matKey = 'metal';
          break;
        default:
          matKey = 'plain';
      }
      const g = get(matKey);
      const uOff = Math.floor(b.uvOffset * 4) / 4;
      const isWall = b.style === 'muro';
      const uvScale = matKey === 'plain' ? 4 : matKey === 'metal' ? 3 : FACADE_M;
      const parapet = roofParapet(b);
      for (const side of ['S', 'N', 'W', 'E']) {
        const f = faceFrame(b, side);
        // Cimiento visible en la ladera (concreto) + fachada.
        if (groundY - baseY > 0.05) concrete.wall(f.x0, f.z0, f.nx, f.nz, f.len, baseY, groundY, 3, [0.8, 0.78, 0.74]);
        if (!layout) g.wall(f.x0, f.z0, f.nx, f.nz, f.len, groundY, topY + parapet, uvScale, color, uOff, groundY);
      }
      if (layout) this.facades.add(b, layout, parapet);
      // Murales en culatas de algunas casas (arte urbano, como en Moravia).
      if (b.style !== 'torre' && !isWall && !b.interior && rng.chance(b.informal ? 0.08 : 0.04) && topY - groundY > 5) murals.push(b);
      buildRoof(b, get, rng, out);
    }

    this.facades.build(this.root);
    for (const [key, gb] of groups) {
      let mat;
      if (key.startsWith('brick')) mat = this.materials.brick[+key.slice(5)];
      else if (key.startsWith('stucco')) mat = this.materials.stucco[+key.slice(6)];
      else if (key.startsWith('mural')) mat = this.materials.mural[+key.slice(5)];
      else mat = this.materials[key];
      this._mesh(gb.build(), mat, { name: `edificios-${key}` });
    }

    // Murales: planos pegados a una culata.
    for (const b of murals) {
      const tex = new THREE.MeshStandardMaterial({ map: this.tex.mural[rng.int(0, 2)], roughness: 0.85 });
      const f = faceFrame(b, rng.chance(0.5) ? 'W' : 'E');
      const h = Math.min(8, b.topY - b.groundY - 1);
      const len = Math.min(10, f.len - 1);
      if (len < 3) continue;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(len, h), tex);
      plane.position.set(f.x0 + f.rx * (f.len / 2) + f.nx * 0.03, b.groundY + 1 + h / 2, f.z0 + f.rz * (f.len / 2) + f.nz * 0.03);
      plane.rotation.y = Math.atan2(f.nx, f.nz);
      plane.receiveShadow = true;
      this.root.add(plane);
    }

    // Tanques de agua (negros tipo Eternit o azules).
    const { tanks, rebar } = out;
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

  // ---------------------------------------------------------------- utilería
  _props() {
    const props = this.city.props;
    const byType = {};
    for (const p of props) (byType[p.type] ??= []).push(p);
    // Modelos glTF (props.js) donde los hay; lo demás sigue procedural.
    this._areas(byType);
    const done = buildModelProps(this, byType, { glowSprite });
    this._trees(done.trees);
    if (!done.lamps) this._lamps(byType.lamp ?? []);
    if (!done.poles) this._poles(byType.pole ?? [], byType.cable ?? []);
    if (!done.benches) this._benches(byType.bench ?? []);
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
    buildStreetFurniture(this, byType);
    this._tombs(byType.tomb ?? []);
    this._flowers((byType.garden ?? []).filter((g) => g.flowers && g.poly));
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

  /** Detalle por instancia de árboles, postes y faroles según la cámara. */
  updateLod(camPos) {
    updatePropLod(this, camPos);
    this.facades.update(camPos);
  }

  update(dt, nightFactor) {
    for (const { m, max, base = 0 } of this.nightMaterials) m.emissiveIntensity = base + max * nightFactor;
    if (this.lampGlow) this.lampGlow.opacity = 0.55 * nightFactor;
    if (this.cityLights) this.cityLights.material.opacity = Math.min(1, nightFactor * 1.3);
    this.metro?.update(dt);
  }
}

const BAR_SPACING = 0.25; // m entre barrotes

/** Máscara alfa de barrotes verticales (se repite en U cada BAR_SPACING). */
function barsTexture() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 4;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 16, 4);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 3, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
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

const _fieldTex = {};
/** Textura de cancha: fútbol en prado, o placa polideportiva de concreto. */
function fieldTexture(placa) {
  const key = placa ? 'placa' : 'futbol';
  if (_fieldTex[key]) return _fieldTex[key];
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d');
  if (placa) {
    ctx.fillStyle = '#5d7fa0';
    ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = '#b5553f';
    ctx.fillRect(14, 14, 228, 484);
  } else {
    ctx.fillStyle = '#3c7a2c';
    ctx.fillRect(0, 0, 256, 512);
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = k % 2 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
      ctx.fillRect(0, k * 64, 256, 64);
    }
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, 228, 484);
  ctx.beginPath();
  ctx.moveTo(14, 256);
  ctx.lineTo(242, 256);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(128, 256, 40, 0, Math.PI * 2);
  ctx.stroke();
  if (placa) {
    ctx.beginPath();
    ctx.arc(128, 14, 90, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(128, 498, 90, Math.PI, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.strokeRect(68, 14, 120, 60);
    ctx.strokeRect(68, 438, 120, 60);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _fieldTex[key] = tex;
  return tex;
}
