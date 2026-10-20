// HOTWIRE — entry point. Builds the city, wires systems together, runs the loop, and exposes
// window.__hotwire so scripts (capture harness, smoke tests) can drive the game deterministically.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Input } from './input.js';
import { RNG } from './util/rng.js';
import { createRenderer, createScene, makeWorldMaterial } from './render/scene.js';
import { ChaseCamera } from './render/camera.js';
import { City } from './world/city.js';
import { VehicleSystem } from './vehicles/vehicleSystem.js';
import { Traffic, TrafficLamps } from './vehicles/traffic.js';
import { CAR_TYPES } from './vehicles/carModels.js';
import { Player } from './player/player.js';
import { HUD } from './ui/hud.js';
import { Effects } from './render/effects.js';
import { Sound } from './audio/sound.js';
import { Autopilot } from './player/autopilot.js';
import { clamp } from './util/math.js';

const params = new URLSearchParams(location.search);
const SEED = Number.parseInt(params.get('seed') ?? String(CONFIG.seed), 10) || CONFIG.seed;
const CAPTURE = params.has('capture');       // scripted: no rAF loop, deterministic stepping
const AUTOSTART = params.has('autostart') || params.has('demo');
const DEMO = params.has('demo');
const MUTED = params.has('mute');

const $ = (id) => document.getElementById(id);
if (CAPTURE) document.body.classList.add('capture');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

class Game {
  constructor() {
    this.canvas = $('game');
    this.renderer = createRenderer(this.canvas);
    const sc = createScene();
    this.sceneCtl = sc;
    this.scene = sc.scene;
    this.camera = sc.camera;
    this.input = new Input();
    this.state = 'loading';
    this.time = 0;          // seconds since page load (keeps running on the title screen)
    this.simTime = 0;       // simulated seconds since the game started
    this.accumulator = 0;
    this.paused = false;
    this.eventLog = [];
    this.stats = { crashes: 0, smashed: 0, wrecks: 0, stolen: 0, topKmh: 0 };
    this.listeners = [];
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  async build() {
    const loadfill = $('loadfill');
    loadfill.style.width = '20%';
    await nextFrame();
    this.rng = new RNG(SEED ^ 0x5bd1e995);
    this.material = makeWorldMaterial();
    const t0 = performance.now();
    this.city = new City(SEED, this.material);
    this.scene.add(this.city.group);
    this.buildMs = performance.now() - t0;
    loadfill.style.width = '60%';
    await nextFrame();
    this.vehicles = new VehicleSystem(this.scene, this.city, this.rng.fork());
    this.traffic = new Traffic(this.vehicles, this.city, this.rng.fork());
    this.lamps = new TrafficLamps(this.scene, this.city.net, this.city.lampSlots);
    this.player = new Player(this.scene, this.city, this.vehicles);
    this.hud = new HUD(this.city);
    this.chase = new ChaseCamera(this.camera, this.city);
    this.effects = new Effects(this.scene, this.city);
    this.sound = new Sound();
    this.muted = MUTED;
    if (MUTED) this.sound.setMuted(true);
    if (DEMO) { this.autopilot = new Autopilot(this); $('hud').classList.add('demo'); }
    this._placePlayer();
    this.traffic.populate(this.player.x, this.player.z);
    loadfill.style.width = '100%';
    await nextFrame();
    $('loading').classList.add('hide');
    this.state = 'title';
    const startFn = () => { this.sound.init(); this.sound.resume(); if (this.state === 'title') this.start(); };
    $('startbtn').addEventListener('click', startFn);
    $('title').addEventListener('pointerdown', (e) => { if (e.target.id !== 'startbtn') startFn(); });
    window.addEventListener('pointerdown', () => { this.sound.init(); this.sound.resume(); }, { passive: true });
    this.input.onAnyKey((e) => { startFn(); if (this.autopilot && this.autopilot.enabled && !['F1', 'Escape'].includes(e.code)) { this.autopilot.enabled = false; this.input.clearVirtual(); $('hud').classList.remove('demo'); this.hud.toast('YOU DRIVE', 'autopilot off', '', 2); } });
    if (AUTOSTART && !CAPTURE) this.start();
  }

  /** Start on the plaza's south sidewalk with a tempting car parked at the curb. */
  _placePlayer() {
    const net = this.city.net;
    const roadZ = net.coord(Math.ceil((net.n - 1) / 2));      // street south of the central plaza
    const x = -6, z = roadZ - net.road / 2 - 1.2;
    this.player.teleport(x, z, 0);
    const car = this.vehicles.spawn('marlin', 0xe8402f, x + 1.5, roadZ - net.parkOffset, -Math.PI / 2, 'parked');
    car.sleeping = true;
    this.starterCar = car;
  }

  start() {
    if (this.state === 'playing') return;
    this.state = 'playing';
    $('title').classList.add('hide');
    $('hud').hidden = false;
    this.chase.snap();
    this.emit('start');
  }

  on(type, fn) { this.listeners.push([type, fn]); }
  emit(type, data) { for (const [t, fn] of this.listeners) if (t === type) fn(data); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Advance simulation by dt seconds using fixed sub-steps. */
  step(dt) {
    this.time += dt;
    if (this.state !== 'playing') { this.input.endFrame(); return; }
    if (this.autopilot && !this.paused) this.autopilot.update(dt);
    this.handleInput();
    if (!this.paused) {
      const h = CONFIG.physics.step;
      this.accumulator = Math.min(this.accumulator + dt, h * CONFIG.physics.maxSubSteps);
      while (this.accumulator >= h - 1e-9) {
        this.fixedUpdate(h);
        this.accumulator -= h;
        this.simTime += h;
      }
      this.vehicles.update(dt, this.camera.position.x, this.camera.position.z, CONFIG.parked.cullDistance);
      this.player.updateVisual(dt);
      this.lamps.update(this.simTime);
      this.processEvents(dt);
      this.chase.update(dt, this.cameraTarget(), this.input);
      this.effects.update(dt, this.vehicles.vehicles, this.camera.position.x, this.camera.position.z, this.camera.position.y);
    }
    this.hud.update(dt, this);
    this.input.endFrame();
  }

  handleInput() {
    const input = this.input, p = this.player;
    if (input.justPressed('pause')) { this.paused = !this.paused; this.hud.toast(this.paused ? 'PAUSED' : 'GO', this.paused ? 'press Esc to resume' : '', '', this.paused ? 999 : 0.8); }
    if (this.paused) return;
    if (input.justPressed('camera')) this.chase.cycleMode();
    if (input.justPressed('mute')) { this.muted = !this.muted; this.sound.setMuted(this.muted); this.hud.toast(this.muted ? 'MUTED' : 'SOUND ON', '', '', 1.2); }
    if (input.justPressed('interact')) {
      if (p.state === 'car') { this.exitCar(); }
      else if (p.state === 'walk') { if (p.tryEnter()) this.onEnterCar(p.car); }
    }
    if (p.state === 'car' && p.car) {
      const v = p.car;
      const botDriving = this.autopilot && this.autopilot.enabled;
      const throttle = input.value('forward'), brake = input.value('back');
      const steer = input.axis('left', 'right');
      if (!botDriving) v.setControls(throttle, brake, steer, input.isDown('handbrake'));
      if (input.justPressed('flip')) this.unstick(v);
      if (input.isDown('horn')) { if (!v.horn) this.emit('horn', v); v.horn = 1; } else v.horn = 0;
    }
  }

  onEnterCar(v) {
    this.stats.stolen++;
    this.sound.enterCar();
    this.hud.showCar(v);
    this.hud.toast(v === this.player.lastCar ? 'BACK IN' : 'STOLEN', v.spec.name.toUpperCase() + ' · ' + v.spec.cls, '', 2.0);
    this.chase.snap();
    this.emit('enter', v);
  }
  exitCar() {
    const v = this.player.car;
    if (!v) return;
    this.player.exitCar();
    this.sound.exitCar();
    if (this.autopilot) { v.ai = null; }
    this.hud.hideCar();
    this.chase.snap();
    this.emit('exit', v);
  }
  /** R: when stuck against something, nudge the car back and straighten it. */
  unstick(v) {
    if (v.wrecked) return;
    const near = this.city.net.nearestLane(v.x, v.z, v.yaw);
    if (near && near.dist < 9 && v.speed < 3) {
      const yaw = Math.atan2(near.lane.ex - near.lane.sx, near.lane.ez - near.lane.sz);
      if (!this.vehicles.overlapsAny(near.x, near.z, yaw, v.hl, v.hw, v, 0.3) && !this.vehicles.overlapsStatic(near.x, near.z, yaw, v.hl, v.hw)) {
        v.x = near.x; v.z = near.z; v.yaw = yaw; v.vx = v.vz = v.angVel = 0; v.bounceVel += 1.5;
        this.hud.toast('STRAIGHTENED OUT', '', '', 1.0);
        this.chase.snap();
      }
    }
  }

  fixedUpdate(h) {
    const p = this.player;
    this.traffic.fixedUpdate(h, this.simTime, p);
    this.vehicles.fixedUpdate(h, this.simTime);
    p.fixedUpdate(h, this.input, this.chase.yaw, this.simTime);
    // wrecked while driving: eject after a beat
    if (p.state === 'car' && p.car && p.car.wrecked) {
      this.wreckT = (this.wreckT ?? 0) + h;
      if (this.wreckT > 1.3) { this.wreckT = 0; this.exitCar(); }
    } else this.wreckT = 0;
  }

  processEvents(dt) {
    const events = this.vehicles.drainEvents();
    const p = this.player;
    for (const e of events) {
      const mine = e.a === p.car || e.b === p.car;
      if (e.type === 'crash' || e.type === 'static') {
        if (e.j * (mine ? 1 : 0.5) > 1500) this.stats.crashes++;
        if (mine) {
          const dv = e.j * (p.car ? p.car.invMass : 0.001);
          this.chase.addShake(clamp(dv * 0.1, 0, 1.2));
        } else {
          const d = Math.hypot(e.x - p.x, e.z - p.z);
          if (d < 25) this.chase.addShake(clamp((e.j / 4000) * (1 - d / 25), 0, 0.5));
        }
      } else if (e.type === 'smash') {
        this.stats.smashed++;
        if (e.a === p.car) this.chase.addShake(0.25);
      }
      this.effects.onEvent(e);
      if ((e.type === 'smash' || e.j > 900) && this.eventLog.length < 400) this.eventLog.push({ type: e.type, j: Math.round(e.j || 0), x: Math.round(e.x), z: Math.round(e.z), t: Math.round(this.simTime * 100) / 100, mine, kind: e.kind, prop: e.prop?.type });
      this.emit('event', e);
    }
    // newly wrecked cars explode
    for (const v of this.vehicles.vehicles) {
      if (v.wrecked && !v.exploded) {
        v.exploded = true;
        this.stats.wrecks++;
        const e = { type: 'wreck', x: v.x, z: v.z, a: v, j: 0 };
        this.effects.onEvent(e);
        this.emit('event', e);
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        this.chase.addShake(clamp(1.4 - d / 40, 0.2, 1.4));
        if (d < 120) this.sound.wreck();
        if (v === p.car) this.hud.toast('WRECKED', 'find another ride', 'bad', 3);
      }
    }
    // audio layers
    let fireNear = 0;
    for (const v of this.vehicles.vehicles) if (v.fire) { const d = Math.hypot(v.x - p.x, v.z - p.z); fireNear = Math.max(fireNear, 1 - d / 40); }
    const car = p.state === 'car' ? p.car : null;
    this.sound.update(dt, { inCar: !!car, engineOn: !!(car && car.engineOn), speed: car ? car.speed : 0, top: car ? car.spec.top : 1, throttle: car ? car.throttle : 0, slip: car ? car.slip : 0, horn: !!(car && car.horn), fireNear });
    if (p.hitBy && p.hitBy.time === this.simTime) this.sound.knock();
    // HUD state
    if (p.state === 'car' && p.car) {
      const v = p.car;
      const kmh = v.kmh;
      this.stats.topKmh = Math.max(this.stats.topKmh, kmh);
      this.hud.setSpeed(kmh, v.wrecked ? '—' : v.forwardSpeed < -0.5 ? 'R' : kmh < 1 ? 'N' : 'D');
      this.hud.setDamage(v.health, v.wrecked);
      this.hud.setPrompt(v.speed < 2 && !v.wrecked ? 'Get out' : null);
    } else if (p.state === 'walk') {
      const near = p.reachableCar();
      this.hud.setPrompt(near ? (near === p.lastCar ? `Get back in the ${near.spec.name}` : `Steal the ${near.spec.name}`) : null);
    } else this.hud.setPrompt(null);
  }

  cameraTarget() {
    const p = this.player;
    if (p.inCar && p.car) {
      const v = p.car;
      return { x: v.x, y: 0, z: v.z, yaw: v.yaw, speed: v.speed, vx: v.vx, vz: v.vz, inCar: true, heightOffset: 0.9 };
    }
    return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: p.moveSpeed, vx: p.vx, vz: p.vz, inCar: false, heightOffset: 1.25 };
  }

  render(dt = 1 / 60) {
    if (this.camOverride) {
      const o = this.camOverride;
      this.camera.position.set(o[0], o[1], o[2]);
      this.camera.lookAt(o[3], o[4], o[5]);
    } else if (this.state === 'title') {
      this.chase.cinematic(dt, this.time);
    } else if (this.state === 'playing' && this.paused) {
      this.chase.update(0, this.cameraTarget(), null);
    }
    const cam = this.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const focusDist = this.state === 'title' ? 120 : 60;
    this.sceneCtl.updateSun(cam.position.x + dir.x * focusDist, cam.position.z + dir.z * focusDist);
    this.sceneCtl.update(dt, this.time);
    this.renderer.render(this.scene, this.camera);
  }

  loop() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      this.step(dt);
      this.render(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

const game = new Game();
await game.build();

// ---- scripting / debug API ----
window.__hotwire = {
  ready: true,
  seed: SEED,
  capture: CAPTURE,
  game,
  start: () => game.start(),
  /** advance simulation by `seconds` in fixed-size frames */
  step(seconds, dt = 1 / 60) {
    let left = seconds;
    while (left > 1e-6) { const d = Math.min(dt, left); game.step(d); left -= d; }
  },
  render: (dt = 1 / 60) => game.render(dt),
  cine: (t) => { game.time = t; },
  freeCamera(x, y, z, lx, ly, lz) { game.camOverride = x === null ? null : [x, y, z, lx, ly, lz]; },
  setInput: (map) => game.input.setVirtual(map),
  pulse: (action) => game.input.pulse(action),
  teleportPlayer: (x, z, yaw = 0) => { if (game.player.state === 'car') game.exitCar(); game.player.teleport(x, z, yaw); game.chase.snap(); },
  enterNearestCar: () => { const ok = game.player.tryEnter(); if (ok) game.onEnterCar(game.player.car); return ok; },
  exitCar: () => game.exitCar(),
  spawnCar: (type, x, z, yaw, controller = 'parked') => { const t = CAR_TYPES[type] ? type : 'marlin'; const v = game.vehicles.spawn(t, 0x2c8fe8, x, z, yaw, controller); return v.id; },
  setCarHealth: (h) => { if (game.player.car) game.player.car.health = h; },
  cameraMode: (i) => { game.chase.modeIndex = i; game.chase.snap(); },
  demo: (on) => { if (on && !game.autopilot) game.autopilot = new Autopilot(game); if (game.autopilot) game.autopilot.enabled = !!on; if (!on) game.input.clearVirtual(); },
  stats() { return { ...game.stats, tris: game.city.triCount, colliders: game.city.colliders.length, props: game.city.props.length, parking: game.city.parking.length, lanes: game.city.net.lanes.length, vehicles: game.vehicles.vehicles.length, buildMs: Math.round(game.buildMs), draws: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles }; },
  getState() {
    const p = game.player, v = p.car;
    return {
      state: game.state, time: game.time, simTime: game.simTime, paused: game.paused,
      player: { x: p.x, z: p.z, yaw: p.yaw, state: p.state },
      car: v ? { id: v.id, type: v.type, name: v.spec.name, x: v.x, z: v.z, yaw: v.yaw, kmh: v.kmh, speed: v.speed, health: v.health, wrecked: v.wrecked, lastImpact: { t: v.lastImpact.t, dv: v.lastImpact.dv, x: v.lastImpact.x, z: v.lastImpact.z }, fire: v.fire } : null,
      reachable: p.reachableCar()?.spec.name ?? null,
      aiCount: game.traffic.aiCount(),
      ai: (() => { let moving = 0, stopped = 0, dazed = 0, sum = 0, n = 0, wrecked = 0; for (const c of game.vehicles.vehicles) { if (c.controller !== 'ai') continue; n++; sum += c.speed; if (c.wrecked) wrecked++; else if (c.ai?.state === 'dazed') dazed++; else if (c.speed < 0.3) stopped++; else moving++; } return { n, moving, stopped, dazed, wrecked, avgSpeed: n ? +(sum / n).toFixed(2) : 0 }; })(),
      aiCrashes: game.eventLog.filter((e) => e.type === 'crash' && !e.mine && e.j > 2000).length,
      events: game.eventLog.length,
      lastEvents: game.eventLog.slice(-5),
    };
  },
};

if (!CAPTURE) game.loop();
