// City assembly: road network + themed blocks + perimeter (beach, pier, hills) baked into
// per-block chunk meshes, plus static colliders in a spatial hash and prop instances.
import * as THREE from 'three';
import { CONFIG, PALETTE } from '../config.js';
import { RNG } from '../util/rng.js';
import { GeomBuilder, shade } from '../render/geometry.js';
import { RoadNetwork, buildRoadGeometry } from './roads.js';
import { perimeterBlock, towerBlock, housesBlock, parkBlock, plazaBlock, parkingBlock, gasStationBlock, decorateSidewalk } from './lots.js';
import { tree, PROP_TYPES, buildPropGeometries } from './props.js';

export class SpatialHash {
  constructor(cell = 24) { this.cell = cell; this.map = new Map(); this.items = []; this.stamp = 1; }
  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  insert(item) {
    item._stamp = 0;
    const idx = this.items.push(item) - 1;
    const cx0 = Math.floor(item.x0 / this.cell), cx1 = Math.floor(item.x1 / this.cell);
    const cz0 = Math.floor(item.z0 / this.cell), cz1 = Math.floor(item.z1 / this.cell);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const k = this._key(cx, cz);
      let arr = this.map.get(k);
      if (!arr) { arr = []; this.map.set(k, arr); }
      arr.push(idx);
    }
  }
  query(x0, z0, x1, z1, out = []) {
    out.length = 0;
    const stamp = ++this.stamp;
    const cx0 = Math.floor(x0 / this.cell), cx1 = Math.floor(x1 / this.cell);
    const cz0 = Math.floor(z0 / this.cell), cz1 = Math.floor(z1 / this.cell);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const arr = this.map.get(this._key(cx, cz));
      if (!arr) continue;
      for (const idx of arr) {
        const it = this.items[idx];
        if (it._stamp === stamp) continue;
        it._stamp = stamp;
        if (it.x1 < x0 || it.x0 > x1 || it.z1 < z0 || it.z0 > z1) continue;
        out.push(it);
      }
    }
    return out;
  }
}

export class City {
  constructor(seed = CONFIG.seed, material) {
    const cfg = CONFIG.city;
    this.cfg = cfg;
    this.rng = new RNG(seed);
    this.net = new RoadNetwork(cfg, this.rng.fork());
    const net = this.net;
    this.half = net.half;
    this.bound = net.half + cfg.shoulder;     // invisible wall
    this.colliders = [];
    this.props = [];
    this.parking = [];
    this.lampSlots = [];
    this.lots = [];
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.material = material;

    // chunk builders keyed by block index
    const nb = cfg.n - 1;
    this.chunks = new Map();
    const chunkFor = (x, z) => {
      const bi = Math.max(0, Math.min(nb - 1, Math.floor((x + this.half - cfg.road / 2) / net.pitch)));
      const bj = Math.max(0, Math.min(nb - 1, Math.floor((z + this.half - cfg.road / 2) / net.pitch)));
      const key = bi + ',' + bj;
      let gb = this.chunks.get(key);
      if (!gb) { gb = new GeomBuilder(); this.chunks.set(key, gb); }
      return gb;
    };
    const emit = (x, z, fn) => fn(chunkFor(x, z));

    // ---- roads ----
    buildRoadGeometry(net, emit, this.colliders, this.lampSlots);

    // ---- blocks ----
    const themes = this._assignThemes(nb);
    for (let bj = 0; bj < nb; bj++) for (let bi = 0; bi < nb; bi++) {
      const cx = (net.coord(bi) + net.coord(bi + 1)) / 2;
      const cz = (net.coord(bj) + net.coord(bj + 1)) / 2;
      const lot = { bi, bj, cx, cz, size: cfg.block, inner: cfg.block - 2 * cfg.sidewalk, sidewalk: cfg.sidewalk, theme: themes[bj][bi] };
      this.lots.push(lot);
      const gb = chunkFor(cx, cz);
      const out = { gb, colliders: this.colliders, props: this.props, parking: this.parking };
      // sidewalk slab (block footprint), curb sides slightly darker
      gb.box(cx, cfg.curb / 2, cz, cfg.block, cfg.curb, cfg.block, PALETTE.sidewalk, { sides: [PALETTE.curb, PALETTE.curb, PALETTE.curb, PALETTE.curb], noBottom: true });
      const rng = this.rng.fork();
      switch (lot.theme) {
        case 'downtown': perimeterBlock(lot, rng, out, 'downtown'); break;
        case 'tower': towerBlock(lot, rng, out); break;
        case 'midtown': perimeterBlock(lot, rng, out, 'midtown'); break;
        case 'outer': perimeterBlock(lot, rng, out, 'outer'); break;
        case 'houses': housesBlock(lot, rng, out); break;
        case 'park': parkBlock(lot, rng, out); break;
        case 'plaza': plazaBlock(lot, rng, out); break;
        case 'parking': parkingBlock(lot, rng, out); break;
        case 'gas': gasStationBlock(lot, rng, out); break;
      }
      decorateSidewalk(lot, rng, out, net, lot.theme);
    }

    // ---- curbside parking spots ----
    for (const s of net.parkingSpots(this.rng.fork(), CONFIG.parked.density)) this.parking.push(s);

    // ---- perimeter: outer sidewalk ring, beach + water (south), grass + hills elsewhere ----
    this.far = new GeomBuilder();
    this._buildPerimeter(emit);

    // ---- bake chunks ----
    let tris = 0;
    for (const [key, gb] of this.chunks) {
      if (gb.isEmpty()) continue;
      const mesh = new THREE.Mesh(gb.build(), material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = 'chunk_' + key;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      tris += gb.triCount;
    }
    if (!this.far.isEmpty()) {
      const farMesh = new THREE.Mesh(this.far.build(), material);
      farMesh.receiveShadow = true; farMesh.castShadow = true;
      farMesh.name = 'far';
      this.group.add(farMesh);
      tris += this.far.triCount;
    }
    this.triCount = tris;

    // ---- ground: grass strips around the city (never under the roads, which keeps huge
    // triangles from fighting the road slabs at wide FOVs), plus a dark underlay far below ----
    const grassMat = new THREE.MeshLambertMaterial({ color: PALETTE.grass });
    const L = this.half + cfg.sidewalk;          // outer edge of the sidewalk ring
    const FAR = 2000;
    const strip = (x0, x1, z0, z1) => {
      const w = x1 - x0, d = z1 - z0;
      const geo = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 80)), Math.max(1, Math.round(d / 80)));
      const m = new THREE.Mesh(geo, grassMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
      m.receiveShadow = true;
      m.name = 'ground';
      this.group.add(m);
    };
    strip(-FAR, FAR, -FAR, -L);                       // north
    strip(-FAR, -L, -L, this.waterLine);              // west
    strip(L, FAR, -L, this.waterLine);                // east
    const underlay = new THREE.Mesh(new THREE.PlaneGeometry(2 * L + 2, 2 * L + 2), new THREE.MeshBasicMaterial({ color: 0x2a2630 }));
    underlay.rotation.x = -Math.PI / 2;
    underlay.position.set(0, -0.6, 0);
    underlay.name = 'underlay';
    this.group.add(underlay);

    // ---- static collider hash ----
    this.hash = new SpatialHash(24);
    const b = this.bound;
    this.colliders.push({ x0: -b - 50, z0: -b - 50, x1: b + 50, z1: -b, h: 0, kind: 'wall' });
    this.colliders.push({ x0: -b - 50, z0: b, x1: b + 50, z1: b + 50, h: 0, kind: 'wall' });
    this.colliders.push({ x0: -b - 50, z0: -b, x1: -b, z1: b, h: 0, kind: 'wall' });
    this.colliders.push({ x0: b, z0: -b, x1: b + 50, z1: b, h: 0, kind: 'wall' });
    for (const c of this.colliders) this.hash.insert(c);

    // ---- breakable prop instances ----
    this._buildProps(material);
  }

  _assignThemes(nb) {
    const rng = this.rng.fork();
    const themes = [];
    const c = (nb - 1) / 2;
    for (let bj = 0; bj < nb; bj++) {
      themes.push([]);
      for (let bi = 0; bi < nb; bi++) {
        const d = Math.max(Math.abs(bi - c), Math.abs(bj - c));
        let t;
        if (d <= 1) t = 'downtown';
        else if (d <= 2) t = 'midtown';
        else t = rng.chance(0.5) ? 'houses' : 'outer';
        themes[bj].push(t);
      }
    }
    // specials
    const ci = Math.floor(c), cj = Math.floor(c);
    themes[cj][ci] = 'plaza';
    themes[cj][ci + 1] = 'tower';
    themes[cj + 1][ci] = 'tower';
    themes[cj - 1][ci + 1] = 'tower';
    // one park in midtown ring, one in the outskirts, parking lot near downtown, gas station outside
    themes[cj - 2][ci - 1] = 'park';
    themes[nb - 1][1] = 'park';
    themes[cj + 2][ci + 1] = 'parking';
    themes[0][nb - 2] = 'parking';
    themes[1][0] = 'gas';
    themes[nb - 2][nb - 1] = 'gas';
    // make the beach row (south edge) residential for a resort feel
    for (let bi = 0; bi < nb; bi++) if (themes[nb - 1][bi] === 'outer') themes[nb - 1][bi] = 'houses';
    return themes;
  }

  _buildPerimeter(emit) {
    const cfg = this.cfg;
    const half = this.half, sw = cfg.sidewalk, bound = this.bound;
    const rng = this.rng.fork();
    const far = this.far;
    // outer sidewalk ring (box slabs around the ring road)
    const L = half + sw;
    far.box(0, cfg.curb / 2, -half - sw / 2, 2 * L, cfg.curb, sw, PALETTE.sidewalk, { sides: [PALETTE.curb, PALETTE.curb, PALETTE.curb, PALETTE.curb], noBottom: true });
    far.box(-half - sw / 2, cfg.curb / 2, 0, sw, cfg.curb, 2 * half, PALETTE.sidewalk, { sides: [PALETTE.curb, PALETTE.curb, PALETTE.curb, PALETTE.curb], noBottom: true });
    far.box(half + sw / 2, cfg.curb / 2, 0, sw, cfg.curb, 2 * half, PALETTE.sidewalk, { sides: [PALETTE.curb, PALETTE.curb, PALETTE.curb, PALETTE.curb], noBottom: true });
    // south: promenade + beach + water
    const promW = 9;
    far.box(0, cfg.curb / 2, half + sw / 2, 2 * L, cfg.curb, sw, PALETTE.sidewalk, { sides: [PALETTE.curb, PALETTE.curb, PALETTE.curb, PALETTE.curb], noBottom: true });
    far.box(0, cfg.curb / 2, half + sw + promW / 2, 2 * L, cfg.curb, promW, PALETTE.concrete, { noBottom: true });
    for (let x = -L + 2.5; x <= L - 2.5; x += 5) if (Math.round((x + L) / 5) % 2 === 0) far.slab(x, cfg.curb + 0.005, half + sw + promW / 2, 4.9, promW - 0.2, PALETTE.concreteDark);
    const sandZ0 = half + sw + promW, sandZ1 = half + cfg.shoulder + 6;
    this.waterLine = sandZ1;
    far.box(0, -0.2, (sandZ0 + sandZ1) / 2, 2 * L, 0.44, sandZ1 - sandZ0, PALETTE.sand, { noBottom: true });
    // water
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 1800), new THREE.MeshLambertMaterial({ color: PALETTE.water }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.05, sandZ1 + 900);
    water.receiveShadow = true;
    water.name = 'water';
    this.group.add(water);
    // low-poly waves: pale slabs near the shore
    for (let x = -L + 4; x < L - 4; x += 14) far.slab(x + rng.range(-3, 3), -0.06, sandZ1 + rng.range(2, 10), rng.range(6, 10), rng.range(0.6, 1.2), 0xd5f3f7);
    // palms along the promenade
    for (let x = -L + 10; x <= L - 10; x += 13) {
      tree(far, rng, x + rng.range(-1.5, 1.5), half + sw + promW - 1.6, { type: 'palm', y0: cfg.curb });
      this.colliders.push({ x0: x - 0.5, z0: half + sw + promW - 2.1, x1: x + 0.5, z1: half + sw + promW - 1.1, h: 6, kind: 'tree' });
      if ((x / 13) % 2 === 0) this.props.push({ type: 'bench', x: x + 6, z: half + sw + 2.2, yaw: Math.PI });
      else this.props.push({ type: 'lamp', x: x + 6, z: half + sw + promW - 1.2, yaw: Math.PI });
    }
    // beach umbrellas + towels
    for (let i = 0; i < 26; i++) {
      const ux = rng.range(-L + 6, L - 6), uz = rng.range(sandZ0 + 4, sandZ1 - 6);
      if (Math.abs(ux) < 8) continue; // keep pier approach clear
      const col = rng.pick(PALETTE.awning);
      far.cylinder(ux, 0.02, 2.2, uz, 0.05, 0.05, 4, 0xfff6e6);
      far.cylinder(ux, 1.8, 2.3, uz, 1.6, 0.05, 8, col, { phase: rng.range(0, 1) });
      far.slab(ux + rng.range(-2.5, 2.5), 0.03, uz + rng.range(-2.5, 2.5), 1.0, 2.0, rng.pick(PALETTE.awning), rng.range(0, Math.PI));
    }
    // pier
    const pierZ0 = half + sw + promW, pierLen = 70, pierW = 7;
    for (let z = pierZ0; z < pierZ0 + pierLen; z += 8) for (const px of [-pierW / 2 + 0.6, pierW / 2 - 0.6]) far.cylinder(px, -1.5, 0.6, z, 0.28, 0.28, 6, PALETTE.trunkDark);
    far.box(0, 0.62, pierZ0 + pierLen / 2, pierW, 0.3, pierLen, 0xb98a5a, { top: 0xc99a66 });
    for (let z = pierZ0 + 4; z < pierZ0 + pierLen; z += 4) far.slab(0, 0.78, z, pierW - 0.2, 0.12, 0xa97a4a);
    for (const s of [-1, 1]) far.box(s * (pierW / 2 - 0.15), 1.25, pierZ0 + pierLen / 2, 0.12, 0.1, pierLen, 0xfff6e6);
    for (let z = pierZ0 + 2; z < pierZ0 + pierLen; z += 6) for (const s of [-1, 1]) far.box(s * (pierW / 2 - 0.15), 1.0, z, 0.12, 0.6, 0.12, 0xfff6e6);
    far.box(0, 0.62, pierZ0 + pierLen + 6, 20, 0.3, 14, 0xb98a5a, { top: 0xc99a66 });
    for (const [px, pz] of [[-9, pierZ0 + pierLen], [9, pierZ0 + pierLen], [-9, pierZ0 + pierLen + 12], [9, pierZ0 + pierLen + 12]]) far.cylinder(px, -1.5, 0.6, pz, 0.3, 0.3, 6, PALETTE.trunkDark);
    // kiosk at pier end
    far.box(0, 2.3, pierZ0 + pierLen + 8, 5, 3.2, 4, 0xf28c6a);
    far.gable(0, 3.8, pierZ0 + pierLen + 8, 5.8, 4.8, 1.6, 0xd1573f);
    for (let z = pierZ0 + 10; z < pierZ0 + pierLen; z += 15) this.props.push({ type: 'lamp', x: -pierW / 2 + 0.8, z, yaw: Math.PI / 2 });
    this.colliders.push({ x0: -pierW / 2 - 0.2, z0: pierZ0, x1: -pierW / 2 + 0.1, z1: pierZ0 + pierLen, h: 1.3, kind: 'rail' });
    this.colliders.push({ x0: pierW / 2 - 0.1, z0: pierZ0, x1: pierW / 2 + 0.2, z1: pierZ0 + pierLen, h: 1.3, kind: 'rail' });
    this.colliders.push({ x0: -10, z0: pierZ0 + pierLen + 13, x1: 10, z1: pierZ0 + pierLen + 14, h: 1.3, kind: 'rail' });
    this.colliders.push({ x0: -10, z0: pierZ0 + pierLen, x1: -pierW / 2, z1: pierZ0 + pierLen + 14, h: 0, kind: 'wall' });
    this.colliders.push({ x0: pierW / 2, z0: pierZ0 + pierLen, x1: 10, z1: pierZ0 + pierLen + 14, h: 0, kind: 'wall' });

    // shoulder trees (N, E, W) and far hills
    for (let i = 0; i < 90; i++) {
      const side = rng.int(0, 2);
      let x, z;
      if (side === 0) { x = rng.range(-bound, bound); z = -half - sw - rng.range(6, cfg.shoulder - 4); }
      else if (side === 1) { x = -half - sw - rng.range(6, cfg.shoulder - 4); z = rng.range(-bound, half); }
      else { x = half + sw + rng.range(6, cfg.shoulder - 4); z = rng.range(-bound, half); }
      const t = tree(far, rng, x, z, { y0: 0, scale: rng.range(0.9, 1.5), type: rng.weighted([['round', 4], ['tall', 3], ['pine', 3]]) });
      if (t) this.colliders.push({ x0: x - t.r, z0: z - t.r, x1: x + t.r, z1: z + t.r, h: t.h, kind: 'tree' });
    }
    // beyond the wall: dense tree line so the edge reads as a forest, and rolling hills
    for (let i = 0; i < 160; i++) {
      const side = rng.int(0, 2);
      let x, z;
      if (side === 0) { x = rng.range(-bound - 200, bound + 200); z = -bound - rng.range(2, 60); }
      else if (side === 1) { x = -bound - rng.range(2, 60); z = rng.range(-bound - 100, half + 40); }
      else { x = bound + rng.range(2, 60); z = rng.range(-bound - 100, half + 40); }
      tree(far, rng, x, z, { y0: 0, scale: rng.range(1.2, 1.9), type: rng.weighted([['round', 3], ['tall', 3], ['pine', 4]]) });
    }
    const hills = [[-520, -720, 230], [-180, -820, 290], [260, -780, 250], [640, -640, 210], [-800, -300, 240], [-780, 200, 190], [840, -150, 220], [780, 300, 180], [-900, -620, 300], [900, -520, 270]];
    for (const [hx, hz, r] of hills) {
      far.icosphere(hx, -r * 0.62, hz, r, 1, rng.pick([PALETTE.grassDark, 0x5f9f3a, 0x74ad42]), { scale: [1 + rng.range(0, 0.5), 0.75, 1 + rng.range(0, 0.4)], jitter: 0.05, rng });
    }
  }

  _buildProps(material) {
    this.propGeometries = buildPropGeometries();
    this.propMeshes = {};
    this.propInstances = [];     // {type, x, z, yaw, mesh, index, alive}
    const byType = new Map();
    for (const p of this.props) {
      if (!byType.has(p.type)) byType.set(p.type, []);
      byType.get(p.type).push(p);
    }
    const dummy = new THREE.Object3D();
    this.propHash = new SpatialHash(16);
    for (const [type, list] of byType) {
      const mesh = new THREE.InstancedMesh(this.propGeometries[type], material, list.length);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = 'props_' + type;
      mesh.frustumCulled = false;
      list.forEach((p, i) => {
        dummy.position.set(p.x, 0.14, p.z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const def = PROP_TYPES[type];
        const inst = { type, def, x: p.x, z: p.z, yaw: p.yaw, mesh, index: i, alive: true, x0: p.x - def.radius, z0: p.z - def.radius, x1: p.x + def.radius, z1: p.z + def.radius };
        this.propInstances.push(inst);
        this.propHash.insert(inst);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.propMeshes[type] = mesh;
      this.group.add(mesh);
    }
  }

  /** Remove a breakable prop instance from view (it has been smashed). */
  hideProp(inst) {
    if (!inst.alive) return;
    inst.alive = false;
    const m = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
    inst.mesh.setMatrixAt(inst.index, m);
    inst.mesh.instanceMatrix.needsUpdate = true;
  }

  queryStatic(x0, z0, x1, z1, out) { return this.hash.query(x0, z0, x1, z1, out); }
  queryProps(x0, z0, x1, z1, out) { return this.propHash.query(x0, z0, x1, z1, out); }

  /** Is (x,z) on a road surface (as opposed to a block/sidewalk)? */
  isOnRoad(x, z) {
    const net = this.net;
    const rel = (v) => ((v + this.half) % net.pitch + net.pitch) % net.pitch;
    const rx = rel(x), rz = rel(z);
    const inX = rx < net.road || Math.abs(x) > this.half;
    const inZ = rz < net.road || Math.abs(z) > this.half;
    if (Math.abs(x) > this.half || Math.abs(z) > this.half) return false;
    return rx < net.road || rz < net.road;
  }
}
