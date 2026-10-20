// Traffic: AI drivers that follow lanes, obey lights, keep distance, recover after being
// rammed, and get recycled around the player. Also drives the instanced traffic lamps.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { DIRS, DIR_YAW, LIGHT } from '../world/roads.js';
import { clamp, wrapAngle } from '../util/math.js';

const LAMP_ON = [0xff2a2a, 0xffc83a, 0x37e07a];
const LAMP_OFF = [0x3a1212, 0x3a3010, 0x0f3a22];

export class TrafficLamps {
  constructor(scene, net, slots) {
    this.net = net; this.slots = slots;
    const geo = new THREE.BoxGeometry(0.22, 0.22, 0.12);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, slots.length * 3);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'trafficLamps';
    const dummy = new THREE.Object3D();
    this.state = new Int8Array(slots.length).fill(-1);
    slots.forEach((s, i) => {
      const d = DIRS[s.dir];
      for (let k = 0; k < 3; k++) {
        dummy.position.set(s.x, s.y + 0.36 - k * 0.36, s.z);
        dummy.rotation.set(0, DIR_YAW[s.dir], 0);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i * 3 + k, dummy.matrix);
        this.mesh.setColorAt(i * 3 + k, new THREE.Color(LAMP_OFF[k]));
      }
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
    this._c = new THREE.Color();
  }
  update(time) {
    let changed = false;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const st = this.net.lightState(this.net.nodes[s.node], s.dir, time);
      if (st === this.state[i]) continue;
      this.state[i] = st;
      for (let k = 0; k < 3; k++) { this._c.set(k === (st === LIGHT.GREEN ? 2 : st === LIGHT.YELLOW ? 1 : 0) ? LAMP_ON[k] : LAMP_OFF[k]); this.mesh.setColorAt(i * 3 + k, this._c); }
      changed = true;
    }
    if (changed) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Traffic {
  constructor(vehicles, city, rng) {
    this.vehicles = vehicles; this.city = city; this.net = city.net; this.rng = rng;
    this.cfg = CONFIG.traffic;
    this.spawnTimer = 0;
  }

  /** Fill parking spots and seed moving traffic near a point. */
  populate(px, pz) {
    const rng = this.rng;
    for (const spot of this.city.parking) {
      if (!rng.chance(CONFIG.parked.fill)) continue;
      if (this.vehicles.overlapsAny(spot.x, spot.z, spot.yaw, 2.6, 1.0)) continue;
      const v = this.vehicles.spawnRandom(spot.x, spot.z, spot.yaw + (spot.curb ? 0 : 0), 'parked', { exclude: ['liner'] });
      v.sleeping = true;
    }
    let guard = 0;
    while (this.aiCount() < this.cfg.target && guard++ < 400) this.spawnOne(px, pz, 40, this.cfg.spawnRadius);
  }

  aiCount() { let n = 0; for (const v of this.vehicles.vehicles) if (v.controller === 'ai') n++; return n; }

  spawnOne(px, pz, minDist, maxDist) {
    const rng = this.rng;
    const lane = rng.pick(this.net.lanes);
    const t = rng.range(0.1, 0.9);
    const x = lane.sx + (lane.ex - lane.sx) * t, z = lane.sz + (lane.ez - lane.sz) * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < minDist || d > maxDist) return null;
    const yaw = DIR_YAW[lane.dir];
    if (this.vehicles.overlapsAny(x, z, yaw, 5.6, 1.2, null, 3)) return null;
    const v = this.vehicles.spawnRandom(x, z, yaw, 'ai');
    v.engineOn = true;
    v.setLights(true);
    v.sleeping = false;
    v.ai = { points: [], lane, state: 'drive', stuck: 0, reverseT: 0, limit: this.cfg.speed * rng.range(0.85, 1.15), lastImpactT: -10, waitT: 0 };
    this._pushLane(v.ai, lane, false);
    return v;
  }

  /** Append a lane's end point and a chosen turn to the route. */
  _pushLane(ai, lane, includeStart) {
    if (includeStart) ai.points.push({ x: lane.sx, z: lane.sz, lane, kind: 'start' });
    ai.points.push({ x: lane.ex, z: lane.ez, lane, kind: 'stop' });
    const opts = lane.next;
    if (!opts.length) { ai.dead = true; return; }
    const pick = this.rng.weighted(opts.map((o) => [o, o.weight]));
    pick.pts.forEach((p, i) => ai.points.push({ x: p.x, z: p.z, lane: pick.lane, kind: 'turn', turn: pick.turn, last: i === pick.pts.length - 1 }));
    ai.nextLane = pick.lane;
    ai.nextTurn = pick.turn;
  }

  /** Re-plan from the car's current position (after being knocked off course). */
  replan(v) {
    const ai = v.ai;
    const near = this.net.nearestLane(v.x, v.z, v.yaw);
    ai.points = [];
    ai.dead = false;
    const lane = near.lane;
    // if we are near the end of this lane already, aim at the end then continue
    ai.lane = lane;
    if (near.t < 0.9) {
      const ahead = Math.min(1, near.t + 12 / lane.length);
      ai.points.push({ x: lane.sx + (lane.ex - lane.sx) * ahead, z: lane.sz + (lane.ez - lane.sz) * ahead, lane, kind: 'merge' });
    }
    this._pushLane(ai, lane, false);
    ai.state = 'drive';
    ai.stuck = 0;
  }

  fixedUpdate(h, time, player) {
    const vs = this.vehicles.vehicles;
    for (const v of vs) {
      if (v.controller !== 'ai') continue;
      if (v.wrecked) { v.setControls(0, 0, 0, false); continue; }
      this.drive(v, h, time, player);
    }
    // recycle: despawn far cars, spawn new ones
    this.spawnTimer -= h;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.5;
      const px = player.x, pz = player.z;
      for (let i = vs.length - 1; i >= 0; i--) {
        const v = vs[i];
        if (v.controller !== 'ai' && !(v.controller === 'none' && v !== player.lastCar)) continue;
        if (v === player.car) continue;
        const d = Math.hypot(v.x - px, v.z - pz);
        // jammed for a long time and out of sight: quietly recycle
        if (v.controller === 'ai' && !v.wrecked) { v.jamT = v.speed < 0.3 ? (v.jamT || 0) + 0.5 : 0; }
        if (d > this.cfg.despawnRadius || (d > 60 && v.jamT > 20) || (d > 140 && v.wrecked && (v.wreckAge = (v.wreckAge || 0) + 0.5) > 60)) this.vehicles.remove(v);
      }
      if (this.aiCount() < this.cfg.target) for (let k = 0; k < 6; k++) if (this.spawnOne(px, pz, 110, this.cfg.spawnRadius)) break;
    }
  }

  drive(v, h, time, player, opts = null) {
    const ai = v.ai;
    const reckless = !!(opts && opts.reckless);
    if (ai.dead) { v.setControls(0, 1, 0, false); return; }
    // dazed after a hit: brake, then replan once settled
    if (v.lastImpact.t > ai.lastImpactT && v.lastImpact.dv > 2.5) {
      ai.lastImpactT = v.lastImpact.t;
      if (reckless) { if (v.lastImpact.dv > 4) this.replan(v); }
      else { ai.state = 'dazed'; ai.waitT = 1.2 + Math.min(2.5, v.lastImpact.dv * 0.2); }
    }
    if (ai.state === 'reverse') {
      ai.reverseT -= h;
      v.setControls(0, 0.7, -ai.revSteer, false);
      if (ai.reverseT <= 0) this.replan(v);
      return;
    }

    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = -Math.cos(v.yaw), rz = Math.sin(v.yaw);
    // prune passed points
    while (ai.points.length) {
      const p = ai.points[0];
      const dx = p.x - v.x, dz = p.z - v.z;
      const ahead = dx * fx + dz * fz;
      const dist = Math.hypot(dx, dz);
      const reach = p.kind === 'turn' ? 2.2 : 3.0;
      if (dist < reach || (ahead < 0 && dist < 7)) {
        if (p.kind === 'turn' && p.last) ai.lane = p.lane;
        ai.points.shift();
      } else break;
    }
    if (ai.points.length < 12) {
      const last = ai.points[ai.points.length - 1];
      const lane = last ? (last.kind === 'turn' ? last.lane : (last.lane.next.length ? ai.nextLane : last.lane)) : ai.lane;
      // after the turn points we are at the start of nextLane; push its end + next turn
      if (last && last.kind === 'turn') this._pushLane(ai, last.lane, false);
      else if (!last) this._pushLane(ai, ai.lane, false);
      else this._pushLane(ai, ai.nextLane || lane, false);
    }
    const target = ai.points[0];
    if (!target) { v.setControls(0, 1, 0, false); return; }
    if (reckless && v.wrecked) return;
    if (ai.state === 'dazed') {
      ai.waitT -= h;
      const a0 = wrapAngle(Math.atan2(target.x - v.x, target.z - v.z) - v.yaw);
      v.setControls(0, 1, clamp(a0 * 1.6, -1, 1), false);
      if (ai.waitT <= 0 && v.speed < 1.5) this.replan(v);
      return;
    }

    // steering toward the target point
    const tdx = target.x - v.x, tdz = target.z - v.z;
    const tdist = Math.hypot(tdx, tdz);
    const angle = wrapAngle(Math.atan2(tdx, tdz) - v.yaw);
    let steer = clamp(angle * 1.6, -1, 1);
    // lane keeping on long straights: blend toward the lane line
    if (target.kind === 'stop' && tdist > 12) {
      const lane = target.lane;
      const lx = -(v.x - lane.sx) * (-Math.cos(DIR_YAW[lane.dir])) - (v.z - lane.sz) * Math.sin(DIR_YAW[lane.dir]); // lateral offset (left +)
      steer = clamp(angle * 1.6 - lx * 0.12 * 0 , -1, 1);
    }

    // desired speed
    let desired = reckless ? opts.limit : ai.limit;
    if (Math.abs(angle) > 0.25) desired = Math.min(desired, reckless ? 11 : 5.5);
    const nextTurn = ai.points.find((p) => p.kind === 'turn');
    if (nextTurn) {
      const dT = Math.hypot(nextTurn.x - v.x, nextTurn.z - v.z);
      if (dT < 14) desired = Math.min(desired, nextTurn.turn === 'S' ? desired : reckless ? 9 : nextTurn.turn === 'R' ? 4.8 : 6.0);
    }
    // traffic light at the lane end
    const stopPt = ai.points.find((p) => p.kind === 'stop');
    if (stopPt && !reckless) {
      const lane = stopPt.lane;
      const node = this.net.nodes[lane.to];
      const dStop = Math.hypot(stopPt.x - v.x, stopPt.z - v.z) - v.hl;
      const st = this.net.lightState(node, lane.dir, time);
      let mustStop = st === LIGHT.RED;
      if (st === LIGHT.YELLOW) mustStop = dStop > v.forwardSpeed * 1.1 + 2;
      // left turns yield to oncoming traffic
      if (!mustStop && ai.nextTurn === 'L' && dStop < 7 && this._oncoming(v, lane, node)) mustStop = true;
      // do not enter the box if the lane beyond is blocked (prevents gridlock)
      if (!mustStop && dStop < 14 && ai.nextLane && this._exitBlocked(v, ai.nextLane)) mustStop = true;
      if (mustStop && dStop < 40) {
        const vStop = Math.sqrt(Math.max(0, 2 * 4.5 * (dStop - 0.8)));
        desired = Math.min(desired, dStop < 1.0 ? 0 : vStop);
      }
    }
    // car ahead in our corridor
    const gap = reckless ? null : this._gapAhead(v, player);
    if (gap !== null) {
      const vGap = Math.max(0, gap - 3.0) * 1.1;
      desired = Math.min(desired, vGap);
    }
    // speed control
    const vF = v.forwardSpeed;
    const err = desired - vF;
    let throttle = clamp(err * 0.45, 0, 1), brake = clamp(-err * 0.35, 0, 1);
    if (desired < 0.3 && vF < 0.6) { throttle = 0; brake = 1; }
    v.setControls(throttle, brake, steer, false);
    // stuck detection: wanting to move but making no progress over a few seconds
    ai.progT = (ai.progT || 0) + h;
    if (ai.progT > 2.5) {
      const moved = ai.progX === undefined ? 10 : Math.hypot(v.x - ai.progX, v.z - ai.progZ);
      ai.progX = v.x; ai.progZ = v.z; ai.progT = 0;
      if (desired > 2 && moved < 2.0) ai.stuck += 1; else ai.stuck = 0;
    }
    if (ai.stuck >= (reckless ? 1 : 2)) { ai.state = 'reverse'; ai.reverseT = 1.4; ai.revSteer = steer; ai.stuck = 0; ai.progX = undefined; }
  }

  _exitBlocked(v, lane) {
    const fx = Math.sin(DIR_YAW[lane.dir]), fz = Math.cos(DIR_YAW[lane.dir]);
    for (const o of this.vehicles.vehicles) {
      if (o === v || o.speed > 1.5) continue;
      const dx = o.x - lane.sx, dz = o.z - lane.sz;
      const along = dx * fx + dz * fz, across = Math.abs(-dx * fz + dz * fx);
      if (along > -2 && along < 9 && across < 2.2) return true;
    }
    return false;
  }

  _oncoming(v, lane, node) {
    const od = (lane.dir + 2) % 4;
    for (const o of this.vehicles.vehicles) {
      if (o === v) continue;
      const d = Math.hypot(o.x - node.x, o.z - node.z);
      if (o.speed < 1) {
        // an opposite left-turner waiting at its own stop line: the lower id goes first
        if (o.ai && o.ai.nextTurn === 'L' && d < 13 && o.id < v.id && Math.abs(wrapAngle(o.yaw - DIR_YAW[od])) < 0.5) return true;
        continue;
      }
      if (d > 45 || d / Math.max(o.speed, 0.1) > 4.5) continue;
      // moving toward the node in direction od, and still on the approach side of it
      const yawDiff = Math.abs(wrapAngle(o.yaw - DIR_YAW[od]));
      const approaching = (node.x - o.x) * DIRS[od].x + (node.z - o.z) * DIRS[od].z > 0;
      if (yawDiff < 0.5 && approaching) return true;
    }
    return false;
  }

  _gapAhead(v, player) {
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = -Math.cos(v.yaw), rz = Math.sin(v.yaw);
    let best = null;
    const widen = Math.abs(v.steer) * 2.5;    // look wider into the turn
    const check = (ox, oz, oHalf, oRadius) => {
      const dx = ox - v.x, dz = oz - v.z;
      const lf = dx * fx + dz * fz, lr = dx * rx + dz * rz;
      if (lf < 0 || lf > 30) return;
      if (Math.abs(lr) > v.hw + oRadius * 0.7 + 0.5 + widen * Math.min(1, lf / 10)) return;
      const gap = lf - oHalf - v.hl;
      if (best === null || gap < best) best = gap;
    };
    for (const o of this.vehicles.vehicles) {
      if (o === v) continue;
      if (Math.abs(o.x - v.x) > 34 || Math.abs(o.z - v.z) > 34) continue;
      // use the other car's extent along our forward axis
      const yawDiff = wrapAngle(o.yaw - v.yaw);
      const along = Math.abs(Math.cos(yawDiff)) * o.hl + Math.abs(Math.sin(yawDiff)) * o.hw;
      const across = Math.abs(Math.sin(yawDiff)) * o.hl + Math.abs(Math.cos(yawDiff)) * o.hw;
      check(o.x, o.z, along, across);
    }
    if (player && !player.inCar) check(player.x, player.z, 0.4, 0.5);
    return best;
  }
}
