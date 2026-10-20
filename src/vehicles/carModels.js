// Car catalogue + procedural low-poly car bodies. Front of every car is +z, origin on the
// ground under the car's center. Bodies are built from tapered boxes so hoods, cabins and
// windshields get real rake without any textures.
import * as THREE from 'three';
import { PALETTE } from '../config.js';
import { GeomBuilder, shade } from '../render/geometry.js';

const GLASS = PALETTE.carGlass, TIRE = PALETTE.carTire, HUB = PALETTE.carHub, BUMPER = PALETTE.carBumper, CHROME = PALETTE.carChrome;

/**
 * spec fields: name, cls (display class), L W H (m), g (ground clearance), belt (belt-line
 * height), cabin [z0, z1], roofInset {w, f, r}, mass, accel (m/s²), brake, top (m/s), rev,
 * steer (rad), grip, drift, wheelR, wheelW, axle [front z, rear z], extras(gb, lg, p)
 */
export const CAR_TYPES = {
  puck: { name: 'Puck', cls: 'Hatchback', L: 3.8, W: 1.74, H: 1.52, g: 0.37, belt: 0.86, cabin: [-1.85, 0.75], roofInset: { w: 0.5, f: 0.75, r: 0.15 }, mass: 980, accel: 9, brake: 16, top: 40, rev: 10, steer: 0.62, grip: 10, drift: 2.6, wheelR: 0.33, wheelW: 0.24, axle: [1.18, -1.18], weight: 6 },
  bean: { name: 'Bean', cls: 'Microcar', L: 2.9, W: 1.6, H: 1.6, g: 0.36, belt: 0.84, cabin: [-1.4, 0.9], roofInset: { w: 0.45, f: 0.7, r: 0.2 }, mass: 760, accel: 8, brake: 15, top: 33, rev: 9, steer: 0.68, grip: 10.5, drift: 2.4, wheelR: 0.3, wheelW: 0.22, axle: [0.92, -0.92], weight: 3 },
  marlin: { name: 'Marlin', cls: 'Sedan', L: 4.65, W: 1.86, H: 1.46, g: 0.37, belt: 0.84, cabin: [-1.35, 1.05], roofInset: { w: 0.6, f: 0.85, r: 0.55 }, mass: 1320, accel: 8, brake: 15, top: 45, rev: 10, steer: 0.58, grip: 9.5, drift: 2.4, wheelR: 0.34, wheelW: 0.25, axle: [1.45, -1.45], weight: 8 },
  taxi: { name: 'Marlin Cab', cls: 'Taxi', L: 4.65, W: 1.86, H: 1.46, g: 0.37, belt: 0.84, cabin: [-1.35, 1.05], roofInset: { w: 0.6, f: 0.85, r: 0.55 }, mass: 1320, accel: 8, brake: 15, top: 44, rev: 10, steer: 0.58, grip: 9.5, drift: 2.4, wheelR: 0.34, wheelW: 0.25, axle: [1.45, -1.45], paints: [0xf7b500], weight: 4, extras: taxiExtras },
  longhorn: { name: 'Longhorn', cls: 'Wagon', L: 4.9, W: 1.86, H: 1.5, g: 0.37, belt: 0.84, cabin: [-2.3, 1.0], roofInset: { w: 0.55, f: 0.85, r: 0.12 }, mass: 1480, accel: 7.5, brake: 15, top: 43, rev: 10, steer: 0.56, grip: 9.5, drift: 2.4, wheelR: 0.34, wheelW: 0.25, axle: [1.5, -1.5], weight: 4, extras: roofRack },
  stinger: { name: 'Stinger', cls: 'Sports', L: 4.35, W: 1.92, H: 1.2, g: 0.3, belt: 0.72, cabin: [-1.5, 0.55], roofInset: { w: 0.7, f: 1.0, r: 0.6 }, mass: 1150, accel: 14, brake: 19, top: 60, rev: 12, steer: 0.55, grip: 9.0, drift: 2.0, wheelR: 0.34, wheelW: 0.3, axle: [1.4, -1.35], weight: 3, extras: spoiler },
  comet: { name: 'Comet', cls: 'Muscle', L: 4.95, W: 1.96, H: 1.34, g: 0.33, belt: 0.8, cabin: [-1.45, 0.45], roofInset: { w: 0.6, f: 0.95, r: 0.7 }, mass: 1560, accel: 12, brake: 17, top: 55, rev: 11, steer: 0.54, grip: 8.2, drift: 1.8, wheelR: 0.36, wheelW: 0.3, axle: [1.5, -1.55], weight: 3, extras: racingStripe },
  trekker: { name: 'Trekker', cls: 'SUV', L: 4.8, W: 2.0, H: 1.9, g: 0.5, belt: 1.05, cabin: [-2.1, 1.1], roofInset: { w: 0.5, f: 0.75, r: 0.15 }, mass: 1850, accel: 7.5, brake: 15, top: 42, rev: 10, steer: 0.56, grip: 9.0, drift: 2.3, wheelR: 0.42, wheelW: 0.3, axle: [1.5, -1.5], weight: 5, extras: roofRack },
  bruiser: { name: 'Bruiser', cls: 'Pickup', L: 5.5, W: 2.04, H: 1.95, g: 0.52, belt: 1.08, cabin: [0.0, 1.5], roofInset: { w: 0.45, f: 0.7, r: 0.15 }, mass: 2150, accel: 7.5, brake: 15, top: 41, rev: 10, steer: 0.52, grip: 8.8, drift: 2.2, wheelR: 0.44, wheelW: 0.32, axle: [1.75, -1.7], weight: 5, extras: pickupBed },
  boxcar: { name: 'Boxcar', cls: 'Van', L: 5.3, W: 2.04, H: 2.3, g: 0.45, belt: 1.0, cabin: [-2.55, 1.55], roofInset: { w: 0.25, f: 0.85, r: 0.08 }, mass: 2050, accel: 5.8, brake: 14, top: 35, rev: 9, steer: 0.5, grip: 8.8, drift: 2.3, wheelR: 0.4, wheelW: 0.28, axle: [1.65, -1.65], paints: [0xf2f2f2, 0xfaf0dc, 0x2c8fe8, 0xe8402f, 0xf7b500], weight: 4, extras: vanExtras },
  liner: { name: 'Liner', cls: 'City Bus', L: 11.2, W: 2.55, H: 3.1, g: 0.52, belt: 1.35, cabin: [-5.5, 5.5], roofInset: { w: 0.1, f: 0.25, r: 0.08 }, mass: 9500, accel: 3.6, brake: 11, top: 30, rev: 6, steer: 0.42, grip: 8.5, drift: 2.5, wheelR: 0.52, wheelW: 0.34, axle: [3.6, -3.2], paints: [0xe8402f, 0x2c8fe8, 0x27b06b, 0xff7a1a, 0x7a4bd6], weight: 1.4, extras: busExtras },
};
export const TYPE_KEYS = Object.keys(CAR_TYPES);

const cache = new Map();

/** Build (and cache) the geometries for a car type in a given paint. */
export function carGeometry(typeKey, paint) {
  const key = typeKey + '_' + paint;
  if (cache.has(key)) return cache.get(key);
  const p = CAR_TYPES[typeKey];
  const gb = new GeomBuilder();    // lit body
  const lg = new GeomBuilder();    // unlit lights
  const dark = shade(paint, 0.82);
  const { L, W, H, g, belt } = p;
  const [cz0, cz1] = p.cabin;
  const bumperColor = p.bumperColor ?? BUMPER;

  // lower body: tucked at the bottom, full width at the belt line
  gb.frustum(0, g, belt, 0, W - 0.28, L - 0.22, W, L, paint, { bottom: 0x1a1820, top: paint });
  // hood crease / trunk shade (subtle two-tone on the top surface)
  if (cz1 < L / 2 - 0.5) gb.slab(0, belt + 0.012, (cz1 + L / 2) / 2 + 0.05, W - 0.5, L / 2 - cz1 - 0.35, shade(paint, 0.94));
  if (cz0 > -L / 2 + 0.5) gb.slab(0, belt + 0.012, (cz0 - L / 2) / 2 - 0.05, W - 0.5, cz0 + L / 2 - 0.35, shade(paint, 0.94));
  // cabin: glass sides, painted roof, raked windshield (roof rect shrinks more at the front)
  const cabinLen = cz1 - cz0;
  const ri = p.roofInset;
  const roofLen = cabinLen - ri.f - ri.r;
  const roofCenterOffset = (ri.r - ri.f) / 2;   // roof shifts back when the front rake is larger
  gb.frustum(0, belt, H, (cz0 + cz1) / 2, W - 0.08, cabinLen, W - ri.w * 2 - 0.08, roofLen, GLASS, { top: paint, oz: roofCenterOffset, bottom: paint });
  // pillars: thin painted strips at the four cabin corners
  const pillarsAt = (zBottom, zTop, side) => {
    const xB = side * (W / 2 - 0.04), xT = side * (W / 2 - ri.w - 0.04);
    const c = [0, (belt + H) / 2, 0];
    const w = 0.09;
    gb.quadOut([xB, belt, zBottom - w], [xB, belt, zBottom + w], [xT, H, zTop + w], [xT, H, zTop - w], paint, c);
  };
  for (const s of [-1, 1]) { pillarsAt(cz1, cz1 - ri.f + roofCenterOffset * 0, s); pillarsAt(cz0, cz0 + ri.r, s); }
  // bumpers, grille, lights
  gb.box(0, g + 0.14, L / 2 - 0.06, W - 0.14, 0.26, 0.24, bumperColor);
  gb.box(0, g + 0.14, -L / 2 + 0.06, W - 0.14, 0.26, 0.24, bumperColor);
  gb.box(0, belt - 0.22, L / 2 - 0.01, W * 0.36, 0.17, 0.05, 0x1a1820);
  const hlW = Math.min(0.42, W * 0.22);
  for (const s of [-1, 1]) {
    lg.box(s * (W / 2 - hlW / 2 - 0.1), belt - 0.2, L / 2 + 0.015, hlW, 0.17, 0.05, PALETTE.headlight);
  }
  const tailStart = lg.col.length;
  for (const s of [-1, 1]) lg.box(s * (W / 2 - hlW / 2 - 0.08), belt - 0.18, -L / 2 - 0.015, hlW, 0.15, 0.05, PALETTE.taillightOff);
  const tailEnd = lg.col.length;
  // mirrors
  for (const s of [-1, 1]) gb.box(s * (W / 2 + 0.07), belt + 0.16, cz1 - 0.25, 0.14, 0.1, 0.12, paint);
  // door seam + sills
  gb.box(0, g + 0.05, 0, W + 0.02, 0.08, cabinLen * 0.9, dark);
  if (p.extras) p.extras(gb, lg, p, paint);

  const wheelX = W / 2 - p.wheelW / 2 + 0.03;
  const wheels = [[wheelX, p.wheelR, p.axle[0]], [-wheelX, p.wheelR, p.axle[0]], [wheelX, p.wheelR, p.axle[1]], [-wheelX, p.wheelR, p.axle[1]]];
  const result = { body: gb.build(), lights: lg.build(), tailRange: [tailStart, tailEnd], wheels };
  cache.set(key, result);
  return result;
}

function taxiExtras(gb, lg, p, paint) {
  gb.box(0, p.H + 0.17, -0.1, 0.9, 0.3, 0.32, 0xfff6e6);
  gb.box(0, p.H + 0.17, -0.1, 0.92, 0.14, 0.34, 0x1a1820);
  // checker band
  for (let z = -p.L / 2 + 0.6; z < p.L / 2 - 0.6; z += 0.5) for (const s of [-1, 1]) gb.box(s * (p.W / 2 + 0.005), p.belt - 0.12, z, 0.01, 0.16, 0.25, 0x1a1820);
}
function roofRack(gb, lg, p, paint) {
  const [z0, z1] = p.cabin;
  const len = (z1 - z0) - p.roofInset.f - p.roofInset.r - 0.4;
  const zc = (z0 + z1) / 2 + (p.roofInset.r - p.roofInset.f) / 2;
  for (const s of [-1, 1]) {
    const x = s * (p.W / 2 - p.roofInset.w - 0.18);
    gb.box(x, p.H + 0.09, zc, 0.06, 0.06, len, 0x3a3844);
    for (const dz of [-len / 2 + 0.2, len / 2 - 0.2]) gb.box(x, p.H + 0.045, zc + dz, 0.05, 0.09, 0.05, 0x3a3844);
  }
}
function spoiler(gb, lg, p, paint) {
  const z = -p.L / 2 + 0.3;
  for (const s of [-1, 1]) gb.box(s * (p.W / 2 - 0.3), p.belt + 0.12, z, 0.08, 0.26, 0.14, 0x1a1820);
  gb.box(0, p.belt + 0.28, z, p.W - 0.3, 0.06, 0.4, paint);
  // hood vents
  gb.box(0, p.belt + 0.02, p.L / 2 - 1.1, 0.6, 0.05, 0.5, 0x1a1820);
}
function racingStripe(gb, lg, p, paint) {
  const stripe = 0xfff6e6;
  const y = p.belt + 0.02;
  for (const s of [-0.22, 0.22]) {
    gb.slab(s, y, (p.cabin[1] + p.L / 2) / 2 + 0.05, 0.22, p.L / 2 - p.cabin[1] - 0.4, stripe);
    gb.slab(s, y, (p.cabin[0] - p.L / 2) / 2 - 0.05, 0.22, p.cabin[0] + p.L / 2 - 0.4, stripe);
    gb.slab(s * (1 - p.roofInset.w / (p.W / 2)), p.H + 0.012, (p.cabin[0] + p.cabin[1]) / 2 + (p.roofInset.r - p.roofInset.f) / 2, 0.18, p.cabin[1] - p.cabin[0] - p.roofInset.f - p.roofInset.r - 0.1, stripe);
  }
  gb.box(0, p.belt + 0.08, p.L / 2 - 0.9, 0.7, 0.14, 0.6, 0x1a1820); // hood scoop
}
function pickupBed(gb, lg, p, paint) {
  const z0 = -p.L / 2 + 0.25, z1 = p.cabin[0] - 0.1;
  const len = z1 - z0, zc = (z0 + z1) / 2;
  const top = p.belt + 0.22;
  gb.box(0, p.belt + 0.03, zc, p.W - 0.3, 0.04, len, 0x1a1820);     // bed floor
  for (const s of [-1, 1]) gb.box(s * (p.W / 2 - 0.09), (p.belt + top) / 2, zc, 0.14, top - p.belt, len, paint); // side walls
  gb.box(0, (p.belt + top) / 2, z0 + 0.07, p.W - 0.14, top - p.belt, 0.14, paint);  // tailgate
  gb.box(0, (p.belt + top) / 2, z1 - 0.07, p.W - 0.14, top - p.belt, 0.14, paint);  // headboard
  gb.box(0, p.H + 0.08, p.cabin[1] - 0.55, 1.0, 0.14, 0.35, 0xfff6e6);               // roof light bar
}
function vanExtras(gb, lg, p, paint) {
  // van: cover the rear side glass with painted panels and add a rear door seam
  const [z0, z1] = p.cabin;
  const panelLen = (z1 - z0) * 0.58;
  const zc = z0 + panelLen / 2 + 0.05;
  for (const s of [-1, 1]) gb.box(s * (p.W / 2 - 0.08), (p.belt + p.H) / 2, zc, 0.04, p.H - p.belt - 0.12, panelLen, paint);
  gb.box(0, (p.belt + p.H) / 2, z0 + 0.02, p.W - 0.4, p.H - p.belt - 0.12, 0.05, paint);
  gb.box(0, (p.g + p.H) / 2 + 0.1, z0 + 0.0, 0.03, p.H - p.g - 0.4, 0.08, shade(paint, 0.75));
  // bold side stripe
  for (const s of [-1, 1]) gb.box(s * (p.W / 2 + 0.005), p.belt - 0.3, 0, 0.01, 0.22, p.L - 0.8, 0xff7a1a);
}
function busExtras(gb, lg, p, paint) {
  const [z0, z1] = p.cabin;
  // cream lower band and roof, destination sign, wide windshield pillar strips
  for (const s of [-1, 1]) gb.box(s * (p.W / 2 + 0.005), (p.g + p.belt) / 2 + 0.05, 0, 0.01, p.belt - p.g - 0.3, p.L - 0.5, 0xfaf0dc);
  gb.box(0, p.H + 0.08, 0, p.W - 0.5, 0.16, p.L - 1.2, shade(paint, 0.85));
  gb.box(0, p.H - 0.35, p.L / 2 - 0.05, p.W - 0.6, 0.4, 0.06, 0xfff6e6);
  gb.box(0, p.H - 0.35, p.L / 2 - 0.02, p.W - 0.9, 0.22, 0.03, 0x1a1820);
  // window mullions
  for (let z = z0 + 1.2; z < z1 - 0.6; z += 1.5) for (const s of [-1, 1]) gb.box(s * (p.W / 2 - 0.02), (p.belt + p.H) / 2, z, 0.05, p.H - p.belt - 0.3, 0.1, paint);
  // doors
  for (const z of [p.L / 2 - 2.2, -1.0]) gb.box(p.W / 2 - 0.02, (p.g + p.H) / 2 + 0.1, z, 0.04, p.H - p.g - 0.6, 1.25, 0x1a1820);
  // extra rear wheels (visual only)
  const wg = gb;
  for (const s of [-1, 1]) wg.cylinderX(s * (p.W / 2 - p.wheelW / 2 + 0.03), p.wheelR, p.axle[1] - 1.3, p.wheelR, p.wheelW, 10, TIRE, { capColor: HUB, capRadius: p.wheelR * 0.58, capInset: 0.04 });
}

export function pickPaint(rng, typeKey) {
  const p = CAR_TYPES[typeKey];
  return rng.pick(p.paints || PALETTE.carPaint);
}

export function pickType(rng, opts = {}) {
  const items = TYPE_KEYS.filter((k) => !(opts.exclude || []).includes(k)).map((k) => [k, CAR_TYPES[k].weight]);
  return rng.weighted(items);
}

/** Unit wheel (radius 1, width 1 along x); instances scale it per car type. */
let unitWheelGeo = null;
export function unitWheel() {
  if (!unitWheelGeo) {
    const wg = new GeomBuilder();
    wg.cylinderX(0, 0, 0, 1, 1, 10, TIRE, { capColor: HUB, capRadius: 0.58, capInset: 0.08 });
    unitWheelGeo = wg.build();
  }
  return unitWheelGeo;
}

let bodyMaterial = null, lightMaterial = null, wheelMaterial = null;
export function carMaterials() {
  if (!bodyMaterial) {
    bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.08 });
    lightMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    wheelMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  }
  return { bodyMaterial, lightMaterial, wheelMaterial };
}
