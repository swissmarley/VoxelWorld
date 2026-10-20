// Road network: a grid of intersections joined by two-lane streets. Produces lane data for
// traffic AI (lanes, turn curves, stop lines, light phases) and the road/marking geometry.
import { PALETTE } from '../config.js';
import { bezier2 } from '../util/math.js';

export const DIRS = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }]; // E S W N
export const DIR_YAW = [Math.PI / 2, 0, -Math.PI / 2, Math.PI]; // yaw with forward = (sin yaw, cos yaw): E S W N
export const rightOf = (d) => ({ x: -DIRS[d].z, z: DIRS[d].x });

export const LIGHT = { GREEN: 0, YELLOW: 1, RED: 2 };
const GREEN_T = 9, YELLOW_T = 2.6, CLEAR_T = 1.2;
const PHASE_T = GREEN_T + YELLOW_T + CLEAR_T;
const CYCLE_T = PHASE_T * 2;

export class RoadNetwork {
  constructor(cfg, rng) {
    this.n = cfg.n;
    this.road = cfg.road;
    this.pitch = cfg.block + cfg.road;
    this.half = ((this.n - 1) * this.pitch + this.road) / 2;
    this.laneOffset = cfg.lane / 2;
    this.parkOffset = cfg.lane + (cfg.road / 2 - cfg.lane) / 2; // center of parking lane
    this.parkWidth = cfg.road / 2 - cfg.lane;
    this.stopDist = cfg.road / 2 + 3.6;   // lane ends (stop line) this far from node center
    this.crossStart = cfg.road / 2 + 0.6;
    this.crossEnd = cfg.road / 2 + 2.9;
    this.nodes = [];
    this.lanes = [];
    this.segments = [];
    this.rng = rng;
    this._build();
  }

  coord(i) { return (i - (this.n - 1) / 2) * this.pitch; }
  nodeAt(i, j) { return this.nodes[j * this.n + i]; }

  _build() {
    const n = this.n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      this.nodes.push({ id: this.nodes.length, i, j, x: this.coord(i), z: this.coord(j), out: [[], [], [], []], inc: [[], [], [], []], degree: 0, hasLight: false, lightOffset: 0 });
    }
    const addLane = (from, to, dir) => {
      const d = DIRS[dir], r = rightOf(dir);
      const sx = from.x + d.x * this.stopDist + r.x * this.laneOffset;
      const sz = from.z + d.z * this.stopDist + r.z * this.laneOffset;
      const ex = to.x - d.x * this.stopDist + r.x * this.laneOffset;
      const ez = to.z - d.z * this.stopDist + r.z * this.laneOffset;
      const lane = { id: this.lanes.length, dir, from: from.id, to: to.id, sx, sz, ex, ez, length: Math.hypot(ex - sx, ez - sz), next: [], seg: null };
      this.lanes.push(lane);
      from.out[dir].push(lane);
      to.inc[dir].push(lane);
      return lane;
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = this.nodeAt(i, j);
      if (i + 1 < n) {
        const b = this.nodeAt(i + 1, j);
        const seg = { id: this.segments.length, a: a.id, b: b.id, horizontal: true, x0: a.x, z0: a.z, x1: b.x, z1: b.z };
        this.segments.push(seg);
        const l1 = addLane(a, b, 0), l2 = addLane(b, a, 2);
        l1.seg = l2.seg = seg.id;
        a.degree++; b.degree++;
      }
      if (j + 1 < n) {
        const b = this.nodeAt(i, j + 1);
        const seg = { id: this.segments.length, a: a.id, b: b.id, horizontal: false, x0: a.x, z0: a.z, x1: b.x, z1: b.z };
        this.segments.push(seg);
        const l1 = addLane(a, b, 1), l2 = addLane(b, a, 3);
        l1.seg = l2.seg = seg.id;
        a.degree++; b.degree++;
      }
    }
    // turn connections
    for (const lane of this.lanes) {
      const node = this.nodes[lane.to];
      const d = lane.dir;
      const options = [[d, 'S', 0.56], [(d + 1) % 4, 'R', 0.24], [(d + 3) % 4, 'L', 0.2]];
      for (const [od, turn, weight] of options) {
        const outs = node.out[od];
        if (!outs.length) continue;
        const out = outs[0];
        const p0 = { x: lane.ex, z: lane.ez }, p3 = { x: out.sx, z: out.sz };
        const dist = Math.hypot(p3.x - p0.x, p3.z - p0.z);
        const k = turn === 'S' ? dist / 3 : turn === 'R' ? dist * 0.42 : dist * 0.5;
        const p1 = { x: p0.x + DIRS[d].x * k, z: p0.z + DIRS[d].z * k };
        const p2 = { x: p3.x - DIRS[od].x * k, z: p3.z - DIRS[od].z * k };
        const steps = turn === 'S' ? 2 : 9;
        const pts = [];
        for (let s = 1; s <= steps; s++) pts.push(bezier2(p0, p1, p2, p3, s / steps));
        lane.next.push({ lane: out, turn, weight, pts });
      }
    }
    for (const node of this.nodes) {
      node.hasLight = node.degree >= 3;
      node.lightOffset = this.rng.range(0, CYCLE_T);
      // alternate phase offsets in a checkerboard so adjacent lights are staggered but not random noise
      node.lightOffset = ((node.i + node.j) % 2) * PHASE_T + this.rng.range(-2, 2);
    }
  }

  /** Light state for traffic approaching `node` travelling in `dir`, at time t. */
  lightState(node, dir, t) {
    if (!node.hasLight) return LIGHT.GREEN;
    const tt = ((t + node.lightOffset) % CYCLE_T + CYCLE_T) % CYCLE_T;
    const nsPhase = tt < PHASE_T;
    const local = nsPhase ? tt : tt - PHASE_T;
    const isNS = dir === 1 || dir === 3;
    if (isNS !== nsPhase) return LIGHT.RED;
    if (local < GREEN_T) return LIGHT.GREEN;
    if (local < GREEN_T + YELLOW_T) return LIGHT.YELLOW;
    return LIGHT.RED;
  }

  /** Closest lane to a point; returns {lane, t (0..1 along lane), dist, x, z} */
  nearestLane(x, z, preferDirYaw = null) {
    let best = null;
    for (const lane of this.lanes) {
      const dx = lane.ex - lane.sx, dz = lane.ez - lane.sz;
      const len2 = dx * dx + dz * dz;
      let t = ((x - lane.sx) * dx + (z - lane.sz) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = lane.sx + dx * t, pz = lane.sz + dz * t;
      let dist = Math.hypot(px - x, pz - z);
      if (preferDirYaw !== null) {
        const yaw = DIR_YAW[lane.dir];
        let diff = Math.abs(((yaw - preferDirYaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
        dist += diff * 2.5; // penalize lanes going the wrong way
      }
      if (!best || dist < best.dist) best = { lane, t, dist, x: px, z: pz };
    }
    return best;
  }

  isInsideCity(x, z, margin = 0) {
    return Math.abs(x) <= this.half + margin && Math.abs(z) <= this.half + margin;
  }

  /** Parking spots along every street's parking lanes: {x, z, yaw, dir} */
  parkingSpots(rng, density) {
    const spots = [];
    const spotLen = 6.4;
    for (const seg of this.segments) {
      const a = this.nodes[seg.a], b = this.nodes[seg.b];
      const dir = seg.horizontal ? 0 : 1;
      const d = DIRS[dir];
      const usable = this.pitch - 2 * (this.road / 2 + 4.5);
      const count = Math.floor(usable / spotLen);
      const startOff = this.road / 2 + 4.5 + (usable - count * spotLen) / 2 + spotLen / 2;
      for (let side = 0; side < 2; side++) {
        const ld = side === 0 ? dir : (dir + 2) % 4;      // traffic direction on this side
        const r = rightOf(ld);
        for (let k = 0; k < count; k++) {
          if (!rng.chance(density)) continue;
          const along = startOff + k * spotLen;
          const x = a.x + d.x * along + r.x * this.parkOffset;
          const z = a.z + d.z * along + r.z * this.parkOffset;
          spots.push({ x, z, yaw: DIR_YAW[ld], dir: ld, curb: true });
        }
      }
    }
    return spots;
  }
}

/** Emit road surfaces, markings and traffic-light poles. `emit(x, z, fn)` routes geometry into chunks. */
export function buildRoadGeometry(net, emit, colliders, lampSlots) {
  const R = net.road / 2;
  const Y_ROAD = 0.03, Y_MARK = 0.055;
  // intersections
  for (const node of net.nodes) {
    emit(node.x, node.z, (gb) => {
      gb.slab(node.x, Y_ROAD, node.z, net.road, net.road, PALETTE.road);
      // crosswalks on each approach that has a road
      for (let d = 0; d < 4; d++) {
        if (!node.out[d].length && !node.inc[d].length) continue;
        const dv = DIRS[d], rv = rightOf(d);
        const mid = (net.crossStart + net.crossEnd) / 2, w = net.crossEnd - net.crossStart;
        const cx = node.x + dv.x * mid, cz = node.z + dv.z * mid;
        // road slab under crosswalk/stop zone so segments can stop short
        gb.slab(node.x + dv.x * (R + 1.8), Y_ROAD, node.z + dv.z * (R + 1.8), d % 2 === 0 ? 3.6 : net.road, d % 2 === 0 ? net.road : 3.6, PALETTE.road);
        const stripes = 9;
        for (let s = 0; s < stripes; s++) {
          const off = -R + 0.9 + s * ((net.road - 1.8) / (stripes - 1));
          gb.slab(cx + rv.x * off, Y_MARK, cz + rv.z * off, d % 2 === 0 ? w : 0.62, d % 2 === 0 ? 0.62 : w, PALETTE.crosswalk);
        }
        // stop line for traffic arriving from direction opposite d? No: arriving traffic travels in dir (d+2)%4 and stops at node.x + dv*stopDist on its right side.
        const arriveDir = (d + 2) % 4;
        if (node.inc[arriveDir].length) {
          const ar = rightOf(arriveDir);
          const sx = node.x + dv.x * (net.stopDist - 0.3), sz = node.z + dv.z * (net.stopDist - 0.3);
          gb.slab(sx + ar.x * (R / 2), Y_MARK, sz + ar.z * (R / 2), d % 2 === 0 ? 0.5 : R, d % 2 === 0 ? R : 0.5, PALETTE.marking);
        }
      }
      // traffic light poles at the four corners (far-right corner of each approach)
      if (node.hasLight) {
        for (let d = 0; d < 4; d++) {
          if (!node.inc[d].length) continue; // approach travelling in dir d
          const dv = DIRS[d], rv = rightOf(d);
          const px = node.x + dv.x * (R + 1.1) + rv.x * (R + 1.1);
          const pz = node.z + dv.z * (R + 1.1) + rv.z * (R + 1.1);
          gb.cylinder(px, 0.1, 5.2, pz, 0.13, 0.11, 7, PALETTE.lampPost);
          // mast arm toward the road center (opposite of right vector)
          const armLen = 3.2;
          const ax = px - rv.x * armLen / 2, az = pz - rv.z * armLen / 2;
          gb.box(ax, 5.1, az, d % 2 === 0 ? 0.16 : armLen, 0.16, d % 2 === 0 ? armLen : 0.16, PALETTE.lampPost);
          // signal head hanging at arm end facing back toward the approach (-dv)
          const hx = px - rv.x * (armLen - 0.3), hz = pz - rv.z * (armLen - 0.3);
          const hy = 4.35;
          gb.box(hx, hy, hz, d % 2 === 0 ? 0.3 : 0.42, 1.15, d % 2 === 0 ? 0.42 : 0.3, 0x2a2733);
          // hood/visors
          for (let k = 0; k < 3; k++) gb.box(hx - dv.x * 0.2, hy + 0.36 - k * 0.36 + 0.12, hz - dv.z * 0.2, d % 2 === 0 ? 0.14 : 0.44, 0.05, d % 2 === 0 ? 0.44 : 0.14, 0x2a2733);
          lampSlots.push({ node: node.id, dir: d, x: hx - dv.x * 0.18, y: hy, z: hz - dv.z * 0.18, face: d });
          colliders.push({ x0: px - 0.2, z0: pz - 0.2, x1: px + 0.2, z1: pz + 0.2, h: 5.2, kind: 'pole' });
        }
      }
    });
  }
  // segments
  for (const seg of net.segments) {
    const a = net.nodes[seg.a], b = net.nodes[seg.b];
    const d = seg.horizontal ? DIRS[0] : DIRS[1];
    const len = net.pitch - 2 * (R + 3.6);
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    emit(mx, mz, (gb) => {
      gb.slab(mx, Y_ROAD, mz, seg.horizontal ? len : net.road, seg.horizontal ? net.road : len, PALETTE.road);
      // center dashes (yellow)
      const dash = 2.4, gap = 2.4;
      const count = Math.floor((len - 2) / (dash + gap));
      const start = -((count - 1) * (dash + gap)) / 2;
      for (let k = 0; k < count; k++) {
        const off = start + k * (dash + gap);
        gb.slab(mx + d.x * off, Y_MARK, mz + d.z * off, seg.horizontal ? dash : 0.16, seg.horizontal ? 0.16 : dash, PALETTE.markingYellow);
      }
      // parking lane edge: subtle lighter line separating lane from parking
      for (const s of [-1, 1]) {
        const off = s * (net.road / 2 - net.parkWidth);
        const r = rightOf(seg.horizontal ? 0 : 1);
        gb.slab(mx + r.x * off, Y_MARK - 0.005, mz + r.z * off, seg.horizontal ? len : 0.12, seg.horizontal ? 0.12 : len, 0x5a5563);
      }
    });
  }
}
