// Block layouts. Each function fills one 64 m block (55 m buildable interior inside a
// 4.5 m sidewalk ring) with a themed arrangement and records colliders, props and parking.
import { PALETTE } from '../config.js';
import { shade } from '../render/geometry.js';
import { buildBuilding, buildHouse } from './buildings.js';
import { tree, busShelter, planter } from './props.js';

const Y = 0.15; // top of sidewalk slab + 1 cm

function addBox(out, x0, z0, x1, z1, h, kind = 'building') {
  out.colliders.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h, kind });
}
function addProp(out, type, x, z, yaw = 0) { out.props.push({ type, x, z, yaw }); }
function addTree(out, rng, x, z, opts) {
  const t = tree(out.gb, rng, x, z, opts);
  if (t) addBox(out, x - t.r, z - t.r, x + t.r, z + t.r, t.h, 'tree');
}
function pickColor(rng, avoid) {
  let c = rng.pick(PALETTE.buildings);
  let guard = 0;
  while (c === avoid && guard++ < 5) c = rng.pick(PALETTE.buildings);
  return c;
}
function ground(out, lot, color, inset = 0) {
  out.gb.slab(lot.cx, Y, lot.cz, lot.inner - inset * 2, lot.inner - inset * 2, color);
}

/** Split a length into segments between min and max, filling it exactly. */
function splitLength(rng, len, min, max) {
  const parts = [];
  let remaining = len;
  while (remaining > 0) {
    let w = rng.range(min, max);
    if (remaining - w < min) w = remaining;
    parts.push(w);
    remaining -= w;
  }
  return parts;
}

/**
 * Perimeter block: buildings line all four streets with a courtyard inside.
 * theme: 'downtown' | 'midtown' | 'outer'
 */
export function perimeterBlock(lot, rng, out, theme) {
  const H = lot.inner / 2;
  const depthN = rng.range(13, 18), depthS = rng.range(13, 18), depthE = rng.range(12, 17), depthW = rng.range(12, 17);
  ground(out, lot, theme === 'downtown' ? PALETTE.concrete : PALETTE.grassDark);
  const strips = [
    { side: 3, x0: lot.cx - H, x1: lot.cx + H, z0: lot.cz - H, z1: lot.cz - H + depthN, along: 'x' },
    { side: 1, x0: lot.cx - H, x1: lot.cx + H, z0: lot.cz + H - depthS, z1: lot.cz + H, along: 'x' },
    { side: 0, x0: lot.cx + H - depthE, x1: lot.cx + H, z0: lot.cz - H + depthN, z1: lot.cz + H - depthS, along: 'z' },
    { side: 2, x0: lot.cx - H, x1: lot.cx - H + depthW, z0: lot.cz - H + depthN, z1: lot.cz + H - depthS, along: 'z' },
  ];
  let lastColor = null;
  for (const strip of strips) {
    const len = strip.along === 'x' ? strip.x1 - strip.x0 : strip.z1 - strip.z0;
    if (len < 8) continue;
    const parts = theme === 'downtown' ? splitLength(rng, len, 14, 28) : splitLength(rng, len, 9, 17);
    let u = 0;
    for (let k = 0; k < parts.length; k++) {
      const w = parts[k];
      const gap = (k < parts.length - 1 && rng.chance(0.3)) ? 1.2 : 0;
      const u0 = u + (k === 0 ? 0 : 0.0), u1 = u + w - gap;
      u += w;
      if (u1 - u0 < 6) continue;
      // vary depth per building a little for a jagged inner edge and roofline
      const dShrink = rng.range(0, 3);
      let fp;
      if (strip.along === 'x') fp = { x0: strip.x0 + u0, x1: strip.x0 + u1, z0: strip.side === 3 ? strip.z0 : strip.z0 + dShrink, z1: strip.side === 3 ? strip.z1 - dShrink : strip.z1 };
      else fp = { z0: strip.z0 + u0, z1: strip.z0 + u1, x0: strip.side === 0 ? strip.x0 + dShrink : strip.x0, x1: strip.side === 0 ? strip.x1 : strip.x1 - dShrink };
      // which sides face streets: the strip's outer side, plus the block edge for corner buildings
      const streetSides = [strip.side];
      if (strip.along === 'x') { if (fp.x0 <= lot.cx - H + 0.01) streetSides.push(2); if (fp.x1 >= lot.cx + H - 0.01) streetSides.push(0); }
      const color = pickColor(rng, lastColor); lastColor = color;
      let style, height;
      if (theme === 'downtown') {
        style = rng.weighted([['office', 6], ['apartment', 3], ['shop', 1]]);
        height = style === 'shop' ? rng.range(9, 14) : rng.range(18, 36);
      } else if (theme === 'midtown') {
        style = rng.weighted([['shop', 5], ['apartment', 4], ['office', 1.5]]);
        height = style === 'shop' ? rng.range(7.5, 12) : style === 'office' ? rng.range(14, 22) : rng.range(10, 17);
      } else {
        style = rng.weighted([['shop', 4], ['apartment', 2], ['warehouse', 3]]);
        height = style === 'warehouse' ? rng.range(6, 9) : style === 'shop' ? rng.range(7, 10.5) : rng.range(9.5, 13);
      }
      buildBuilding(out.gb, rng, { fp, y0: Y, height, style, color, trim: rng.pick(PALETTE.trims), roof: rng.pick(PALETTE.roofs), streetSides });
      addBox(out, fp.x0, fp.z0, fp.x1, fp.z1, Y + height, 'building');
    }
  }
  // courtyard
  const cx0 = lot.cx - H + depthW + 1, cx1 = lot.cx + H - depthE - 1, cz0 = lot.cz - H + depthN + 1, cz1 = lot.cz + H - depthS - 1;
  if (cx1 - cx0 > 6 && cz1 - cz0 > 6) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) addTree(out, rng, rng.range(cx0 + 2, cx1 - 2), rng.range(cz0 + 2, cz1 - 2), { scale: rng.range(0.8, 1.1) });
  }
}

/** A single landmark tower on a plaza. */
export function towerBlock(lot, rng, out) {
  const H = lot.inner / 2;
  ground(out, lot, PALETTE.concrete);
  // paving pattern: darker squares
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if ((i + j) % 2 === 0) out.gb.slab(lot.cx + i * 10, Y + 0.005, lot.cz + j * 10, 9.6, 9.6, PALETTE.concreteDark);
  const size = rng.range(28, 34);
  const ox = rng.range(-5, 5), oz = rng.range(-5, 5);
  const fp = { x0: lot.cx + ox - size / 2, x1: lot.cx + ox + size / 2, z0: lot.cz + oz - size / 2, z1: lot.cz + oz + size / 2 };
  const height = rng.range(44, 66);
  buildBuilding(out.gb, rng, { fp, y0: Y, height, style: 'tower', color: rng.pick(PALETTE.towerGlass), trim: rng.pick([0xfff6e6, 0x2d2a38]), streetSides: [1] });
  addBox(out, fp.x0, fp.z0, fp.x1, fp.z1, Y + height, 'building');
  // planters + trees around the edge, bollards at corners
  for (let k = -2; k <= 2; k++) {
    for (const [px, pz] of [[lot.cx + k * 11, lot.cz - H + 2.2], [lot.cx + k * 11, lot.cz + H - 2.2], [lot.cx - H + 2.2, lot.cz + k * 11], [lot.cx + H - 2.2, lot.cz + k * 11]]) {
      if (Math.abs(px - (lot.cx + ox)) < size / 2 + 3 && Math.abs(pz - (lot.cz + oz)) < size / 2 + 3) continue;
      if (rng.chance(0.5)) { planter(out.gb, rng, px, pz, 2.2, 2.2); addBox(out, px - 1.1, pz - 1.1, px + 1.1, pz + 1.1, 1.0, 'planter'); }
      else addTree(out, rng, px, pz, { type: 'round', scale: rng.range(0.8, 1.0) });
    }
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) for (let k = 0; k < 3; k++) addProp(out, 'bollard', lot.cx + sx * (H - 1.2 - k * 1.6), lot.cz + sz * (H - 1.2), 0);
}

/** Residential: houses with lawns facing the north and south streets. */
export function housesBlock(lot, rng, out) {
  const H = lot.inner / 2;
  ground(out, lot, PALETTE.grass);
  const cols = 3;
  const lw = lot.inner / cols;
  for (const side of [3, 1]) {              // 3 = north street (-z), 1 = south street (+z)
    for (let c = 0; c < cols; c++) {
      const lx = lot.cx - H + lw * (c + 0.5);
      const edgeZ = side === 3 ? lot.cz - H : lot.cz + H;
      const inward = side === 3 ? 1 : -1;
      const w = rng.range(9.5, 12.5), d = rng.range(8, 10);
      const setback = rng.range(6.5, 9);
      const hz = edgeZ + inward * (setback + d / 2);
      const hx = lx + rng.range(-1.5, 1.5);
      const color = pickColor(rng, null);
      const floors = rng.chance(0.55) ? 2 : 1;
      buildHouse(out.gb, rng, { cx: hx, cz: hz, w, d, floors, color, roof: rng.pick(PALETTE.roofs), trim: 0xfff6e6, facing: side, y0: Y });
      addBox(out, hx - w / 2, hz - d / 2, hx + w / 2, hz + d / 2, Y + floors * 3 + 2.5, 'building');
      // path from sidewalk to door
      const pathLen = setback - 1.3;
      out.gb.slab(hx, Y + 0.01, edgeZ + inward * pathLen / 2, 1.4, pathLen, PALETTE.sidewalk);
      // driveway on one side + maybe a parked car spot
      const dside = rng.sign();
      const dx = hx + dside * (w / 2 + 2.4);
      if (Math.abs(dx - lx) < lw / 2 - 2.6) {
        out.gb.slab(dx, Y + 0.01, edgeZ + inward * (setback + 1) / 2, 3.2, setback + 1, PALETTE.concreteDark);
        if (rng.chance(0.4)) out.parking.push({ x: dx, z: edgeZ + inward * (setback * 0.55), yaw: side === 3 ? 0 : Math.PI, curb: false });
      }
      // fence along the street edge with a gap at the path
      const fx0 = lx - lw / 2 + 0.6, fx1 = lx + lw / 2 - 0.6;
      for (let fx = fx0 + 2; fx < fx1 - 1; fx += 4.0) {
        if (Math.abs(fx - hx) < 2.9) continue;
        if (Math.abs(fx - dx) < 3.0) continue;
        addProp(out, 'fence', fx, edgeZ + inward * 0.9, 0);
      }
      // trees in the lawn and the backyard
      const tx = hx + (rng.chance(0.5) ? -1 : 1) * (w / 2 + rng.range(3.5, 5));
      if (Math.abs(tx - lx) < lw / 2 - 2 && Math.abs(tx - dx) > 3.5) addTree(out, rng, tx, edgeZ + inward * rng.range(3.5, setback - 1), { scale: rng.range(0.8, 1.15) });
      if (rng.chance(0.7)) addTree(out, rng, hx + rng.range(-3, 3), edgeZ + inward * (setback + d + rng.range(3, 6)), { scale: rng.range(0.9, 1.3) });
      if (rng.chance(0.3)) addProp(out, 'mailbox', hx + 1.6, edgeZ + inward * 1.0, 0);
    }
  }
  // garden shed in the middle
  if (rng.chance(0.6)) {
    const sx = lot.cx + rng.range(-10, 10), sz = lot.cz + rng.range(-3, 3);
    out.gb.box(sx, Y + 1.3, sz, 3.2, 2.6, 2.6, rng.pick(PALETTE.buildings));
    out.gb.gable(sx, Y + 2.5, sz, 3.6, 3.0, 1.0, rng.pick(PALETTE.roofs));
    addBox(out, sx - 1.6, sz - 1.3, sx + 1.6, sz + 1.3, 3.5, 'building');
  }
}

/** Public park: paths, pond, pavilion, lots of trees. */
export function parkBlock(lot, rng, out) {
  const H = lot.inner / 2;
  ground(out, lot, PALETTE.grass);
  // cross paths
  out.gb.slab(lot.cx, Y + 0.01, lot.cz, lot.inner, 3.2, PALETTE.sand);
  out.gb.slab(lot.cx, Y + 0.01, lot.cz, 3.2, lot.inner, PALETTE.sand);
  out.gb.disc(lot.cx, Y + 0.012, lot.cz, 9, 16, PALETTE.sand);
  // pavilion at center
  out.gb.disc(lot.cx, Y + 0.3, lot.cz, 4.2, 8, PALETTE.concrete);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = lot.cx + Math.cos(a) * 3.4, pz = lot.cz + Math.sin(a) * 3.4;
    out.gb.box(px, Y + 1.8, pz, 0.26, 3.2, 0.26, 0xfff6e6);
    addBox(out, px - 0.2, pz - 0.2, px + 0.2, pz + 0.2, 3.4, 'pole');
  }
  out.gb.cylinder(lot.cx, Y + 3.3, Y + 3.7, lot.cz, 4.9, 4.9, 8, 0xfff6e6, { phase: Math.PI / 8 });
  out.gb.cylinder(lot.cx, Y + 3.7, Y + 6.2, lot.cz, 4.9, 0.3, 8, rng.pick(PALETTE.roofs), { phase: Math.PI / 8 });
  // pond
  const pondX = lot.cx + rng.range(-14, -10), pondZ = lot.cz + rng.range(10, 14);
  out.gb.disc(pondX, Y + 0.015, pondZ, 8.5, 14, PALETTE.sand);
  out.gb.disc(pondX, Y + 0.02, pondZ, 7.3, 14, PALETTE.water);
  // flower beds
  for (let i = 0; i < 4; i++) {
    const fx = lot.cx + rng.range(-H + 6, H - 6), fz = lot.cz + rng.range(-H + 6, H - 6);
    if (Math.abs(fx - lot.cx) < 5 || Math.abs(fz - lot.cz) < 5) continue;
    if (Math.hypot(fx - pondX, fz - pondZ) < 10) continue;
    out.gb.disc(fx, Y + 0.02, fz, rng.range(1.6, 2.6), 8, rng.pick([0xf06292, 0xf3c53d, 0xff7a1a, 0xd9b1e6]));
  }
  // trees avoiding paths and pond
  for (let i = 0; i < 22; i++) {
    const tx = lot.cx + rng.range(-H + 2.5, H - 2.5), tz = lot.cz + rng.range(-H + 2.5, H - 2.5);
    if (Math.abs(tx - lot.cx) < 3.2 || Math.abs(tz - lot.cz) < 3.2) continue;
    if (Math.hypot(tx - lot.cx, tz - lot.cz) < 10.5) continue;
    if (Math.hypot(tx - pondX, tz - pondZ) < 10) continue;
    addTree(out, rng, tx, tz, { scale: rng.range(0.9, 1.4), type: rng.weighted([['round', 5], ['tall', 3], ['pine', 2]]) });
  }
  // benches and lamps along the paths
  for (const k of [-18, -10, 10, 18]) {
    addProp(out, 'bench', lot.cx + k, lot.cz - 2.4, 0);
    addProp(out, 'bench', lot.cx - 2.4, lot.cz + k, Math.PI / 2);
    addProp(out, 'lamp', lot.cx + k + 4, lot.cz + 2.3, Math.PI);
    addProp(out, 'lamp', lot.cx + 2.3, lot.cz + k + 4, -Math.PI / 2);
  }
  // hedges along the edges (visual only) with openings at the paths
  for (const s of [-1, 1]) {
    for (const half of [-1, 1]) {
      const len = H - 2.6;
      out.gb.box(lot.cx + half * (len / 2 + 2.6), Y + 0.45, lot.cz + s * (H - 0.6), len, 0.9, 1.0, 0x3f8a3a, { noBottom: true });
      out.gb.box(lot.cx + s * (H - 0.6), Y + 0.45, lot.cz + half * (len / 2 + 2.6), 1.0, 0.9, len, 0x3f8a3a, { noBottom: true });
    }
  }
}

/** Civic plaza with a square fountain. */
export function plazaBlock(lot, rng, out) {
  const H = lot.inner / 2;
  ground(out, lot, PALETTE.concrete);
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) if ((i + j) % 2 === 0) out.gb.slab(lot.cx + i * 5, Y + 0.005, lot.cz + j * 5, 4.9, 4.9, PALETTE.concreteDark);
  // fountain
  const B = 7;
  out.gb.box(lot.cx, Y + 0.45, lot.cz, B * 2, 0.9, B * 2, 0xd8cbb3, { noBottom: true, top: 0xcfc4ae });
  out.gb.slab(lot.cx, Y + 0.75, lot.cz, B * 2 - 1.2, B * 2 - 1.2, PALETTE.water);
  out.gb.cylinder(lot.cx, Y + 0.75, Y + 2.6, lot.cz, 1.3, 1.0, 8, 0xd8cbb3);
  out.gb.cylinder(lot.cx, Y + 2.6, Y + 3.0, lot.cz, 0.5, 2.6, 8, 0xd8cbb3);
  out.gb.cylinder(lot.cx, Y + 3.0, Y + 4.2, lot.cz, 0.5, 0.3, 6, 0xd8cbb3);
  out.gb.icosphere(lot.cx, Y + 4.6, lot.cz, 0.9, 1, 0xd5f3f7, { scale: [1, 1.4, 1] });
  addBox(out, lot.cx - B, lot.cz - B, lot.cx + B, lot.cz + B, 1.0, 'fountain');
  // flagpoles
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const px = lot.cx + sx * 12, pz = lot.cz + sz * 12;
    out.gb.cylinder(px, Y, Y + 11, pz, 0.12, 0.08, 6, 0xe9e9f0);
    out.gb.box(px + 1.3, Y + 10.2, pz, 2.6, 1.4, 0.06, rng.pick(PALETTE.awning));
    addBox(out, px - 0.2, pz - 0.2, px + 0.2, pz + 0.2, 11, 'pole');
  }
  // trees in rows on two sides, planters on the others
  for (let k = -2; k <= 2; k++) {
    addTree(out, rng, lot.cx + k * 11, lot.cz - H + 3, { type: 'round', scale: 1.0 });
    addTree(out, rng, lot.cx + k * 11, lot.cz + H - 3, { type: 'round', scale: 1.0 });
    planter(out.gb, rng, lot.cx - H + 2.5, lot.cz + k * 11, 2.4, 2.4); addBox(out, lot.cx - H + 1.3, lot.cz + k * 11 - 1.2, lot.cx - H + 3.7, lot.cz + k * 11 + 1.2, 1, 'planter');
    planter(out.gb, rng, lot.cx + H - 2.5, lot.cz + k * 11, 2.4, 2.4); addBox(out, lot.cx + H - 3.7, lot.cz + k * 11 - 1.2, lot.cx + H - 1.3, lot.cz + k * 11 + 1.2, 1, 'planter');
  }
  for (const k of [-19, -9, 9, 19]) { addProp(out, 'bench', lot.cx + k, lot.cz - 9.5, 0); addProp(out, 'bench', lot.cx + k, lot.cz + 9.5, Math.PI); addProp(out, 'lamp', lot.cx + k, lot.cz + 16, 0); addProp(out, 'lamp', lot.cx + k, lot.cz - 16, Math.PI); }
  // kiosk
  const kx = lot.cx + 19, kz = lot.cz + 19;
  out.gb.box(kx, Y + 1.5, kz, 3.4, 3.0, 3.0, rng.pick(PALETTE.buildings));
  out.gb.box(kx, Y + 3.2, kz, 4.2, 0.3, 3.8, rng.pick(PALETTE.awning));
  out.gb.box(kx, Y + 1.6, kz - 1.52, 2.4, 1.2, 0.04, PALETTE.windowDark);
  addBox(out, kx - 1.7, kz - 1.5, kx + 1.7, kz + 1.5, 3.5, 'building');
}

/** Surface parking lot full of easy steals. */
export function parkingBlock(lot, rng, out) {
  const H = lot.inner / 2;
  ground(out, lot, 0x55505e);
  // two double rows of bays running east-west, aisles between
  const rows = [-16, 0, 16];
  const bayW = 3.0, bayD = 5.6;
  for (const rz of rows) {
    for (const s of [-1, 1]) {
      if (rz === rows[0] && s === -1) continue;
      if (rz === rows[2] && s === 1) continue;
      const zc = rz + s * (bayD / 2 + 0.2);
      const count = Math.floor((lot.inner - 6) / bayW);
      const start = -((count - 1) * bayW) / 2;
      for (let k = 0; k <= count; k++) {
        const bx = lot.cx + start + k * bayW - bayW / 2;
        out.gb.slab(bx, Y + 0.012, lot.cz + zc, 0.12, bayD, PALETTE.marking);
        if (k < count && rng.chance(0.62)) out.parking.push({ x: lot.cx + start + k * bayW, z: lot.cz + zc, yaw: s === -1 ? 0 : Math.PI, curb: false });
      }
    }
  }
  // light masts
  for (const [mx, mz] of [[-20, -8], [20, -8], [-20, 8], [20, 8]]) {
    const px = lot.cx + mx, pz = lot.cz + mz;
    out.gb.cylinder(px, Y, Y + 9, pz, 0.16, 0.1, 6, PALETTE.lampPost);
    out.gb.box(px, Y + 9, pz, 2.4, 0.25, 0.5, PALETTE.lampPost);
    out.gb.box(px, Y + 8.85, pz, 2.2, 0.05, 0.4, PALETTE.lampHead);
    addBox(out, px - 0.25, pz - 0.25, px + 0.25, pz + 0.25, 9, 'pole');
  }
  // booth at the entrance and hedges on three sides
  const bx = lot.cx - H + 6, bz = lot.cz + H - 4;
  out.gb.box(bx, Y + 1.4, bz, 2.4, 2.8, 2.4, 0xfff6e6);
  out.gb.box(bx, Y + 2.95, bz, 3.0, 0.3, 3.0, 0xe84a3c);
  out.gb.box(bx, Y + 1.7, bz + 1.22, 1.8, 1.0, 0.04, PALETTE.windowDark);
  addBox(out, bx - 1.2, bz - 1.2, bx + 1.2, bz + 1.2, 3.2, 'building');
  for (const s of [-1, 1]) out.gb.box(lot.cx + s * (H - 0.6), Y + 0.4, lot.cz, 1.0, 0.8, lot.inner - 4, 0x3f8a3a, { noBottom: true });
  out.gb.box(lot.cx, Y + 0.4, lot.cz - H + 0.6, lot.inner - 4, 0.8, 1.0, 0x3f8a3a, { noBottom: true });
  for (let k = 0; k < 4; k++) addProp(out, 'bollard', lot.cx + 10 + k * 1.5, lot.cz + H - 1.0, 0);
  addProp(out, 'sign', lot.cx - H + 10, lot.cz + H - 1.2, Math.PI);
}

/** Gas station with canopy, pumps and a shop. */
export function gasStationBlock(lot, rng, out) {
  const H = lot.inner / 2;
  ground(out, lot, PALETTE.concrete);
  const brand = rng.pick([0xe84a3c, 0x2f8ad9, 0x3cb371, 0xf3c53d]);
  // canopy
  const cz = lot.cz + 8;
  for (const [sx, sz] of [[-8, -4], [8, -4], [-8, 4], [8, 4]]) {
    out.gb.box(lot.cx + sx, Y + 2.6, cz + sz, 0.7, 5.2, 0.7, 0xfff6e6);
    addBox(out, lot.cx + sx - 0.35, cz + sz - 0.35, lot.cx + sx + 0.35, cz + sz + 0.35, 5.5, 'pole');
  }
  out.gb.box(lot.cx, Y + 5.6, cz, 24, 0.8, 12, 0xfff6e6);
  out.gb.box(lot.cx, Y + 5.6, cz, 24.05, 0.3, 12.05, brand);
  // pumps
  for (const px of [-5, 0, 5]) {
    out.gb.box(lot.cx + px, Y + 0.08, cz, 2.2, 0.16, 1.1, 0xd8cbb3);
    out.gb.box(lot.cx + px, Y + 1.0, cz, 1.0, 1.9, 0.6, 0xfff6e6);
    out.gb.box(lot.cx + px, Y + 1.5, cz, 1.02, 0.4, 0.62, brand);
    addBox(out, lot.cx + px - 0.5, cz - 0.3, lot.cx + px + 0.5, cz + 0.3, 2, 'pump');
    out.parking.push({ x: lot.cx + px, z: cz - 2.4, yaw: Math.PI / 2, curb: false });
  }
  // shop at the back (north)
  const fp = { x0: lot.cx - 9, x1: lot.cx + 9, z0: lot.cz - H + 4, z1: lot.cz - H + 14 };
  buildBuilding(out.gb, rng, { fp, y0: Y, height: 5.5, style: 'shop', color: 0xfaf0dc, trim: brand, roof: 0x3b3747, streetSides: [1] });
  addBox(out, fp.x0, fp.z0, fp.x1, fp.z1, 6, 'building');
  // price sign mast
  const mx = lot.cx + H - 4, mz = lot.cz + H - 4;
  out.gb.box(mx, Y + 4.5, mz, 0.6, 9, 0.6, 0xfff6e6);
  out.gb.box(mx, Y + 9.6, mz, 4.2, 2.4, 0.5, brand);
  out.gb.box(mx, Y + 9.6, mz, 3.6, 1.6, 0.56, 0xfff6e6);
  addBox(out, mx - 0.3, mz - 0.3, mx + 0.3, mz + 0.3, 11, 'pole');
  // air pump, trash, a few cones
  addProp(out, 'trash', lot.cx - 12, cz, 0);
  addProp(out, 'cone', lot.cx + 10, cz + 7, 0);
  addProp(out, 'cone', lot.cx + 11.5, cz + 7.5, 0);
  for (let k = -2; k <= 2; k++) addTree(out, rng, lot.cx - H + 2.5, lot.cz + k * 10, { type: 'round', scale: 0.9 });
}

/** Sidewalk furniture around a block: lamps, street trees, benches, hydrants, shelters, bus stops. */
export function decorateSidewalk(lot, rng, out, net, theme) {
  const H = lot.size / 2;        // block edge (curb)
  const edges = [
    { side: 3, dir: 0, ox: 0, oz: -1 }, // north edge: runs along x, outward is -z
    { side: 1, dir: 0, ox: 0, oz: 1 },
    { side: 2, dir: 1, ox: -1, oz: 0 },
    { side: 0, dir: 1, ox: 1, oz: 0 },
  ];
  for (const e of edges) {
    const len = lot.size - 16; // keep corners clear
    const n = Math.floor(len / 9.5);
    const start = -((n - 1) * 9.5) / 2;
    for (let k = 0; k < n; k++) {
      const along = start + k * 9.5;
      const px = e.dir === 0 ? lot.cx + along : lot.cx + e.ox * (H - 1.1);
      const pz = e.dir === 0 ? lot.cz + e.oz * (H - 1.1) : lot.cz + along;
      // lamp arm points toward the road (outward)
      const yawToRoad = Math.atan2(e.ox, e.oz);
      if (k % 2 === 0) {
        addProp(out, 'lamp', px, pz, yawToRoad);
        if (rng.chance(0.25)) addProp(out, 'trash', px + (e.dir === 0 ? 1.2 : 0), pz + (e.dir === 1 ? 1.2 : 0), yawToRoad);
      } else {
        const tx = e.dir === 0 ? px : lot.cx + e.ox * (H - 1.6);
        const tz = e.dir === 0 ? lot.cz + e.oz * (H - 1.6) : pz;
        if (theme === 'downtown' ? rng.chance(0.55) : rng.chance(0.8)) {
          out.gb.box(tx, Y - 0.005, tz, 1.6, 0.02, 1.6, PALETTE.dirt);
          addTree(out, rng, tx, tz, { type: 'round', scale: rng.range(0.75, 1.0), y0: Y - 0.01 });
        } else if (rng.chance(0.5)) addProp(out, 'bench', tx, tz, yawToRoad + Math.PI);
        else addProp(out, 'hydrant', tx, tz, 0);
      }
    }
    if (rng.chance(0.22)) {
      const sx = e.dir === 0 ? lot.cx + rng.range(-12, 12) : lot.cx + e.ox * (H - 2.4);
      const sz = e.dir === 0 ? lot.cz + e.oz * (H - 2.4) : lot.cz + rng.range(-12, 12);
      busShelter(out.gb, sx, sz, Math.atan2(e.ox, e.oz) + Math.PI);
      addBox(out, sx - 2.2, sz - 1.4, sx + 2.2, sz + 1.4, 2.8, 'shelter');
    }
    if (rng.chance(0.35)) {
      const cx = e.dir === 0 ? lot.cx + rng.range(-20, 20) : lot.cx + e.ox * (H - 2.6);
      const czz = e.dir === 0 ? lot.cz + e.oz * (H - 2.6) : lot.cz + rng.range(-20, 20);
      addProp(out, rng.pick(['newsbox', 'mailbox', 'sign']), cx, czz, yawToRoadFor(e));
    }
  }
  function yawToRoadFor(e) { return Math.atan2(e.ox, e.oz); }
  // corner street signs
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) addProp(out, 'sign', lot.cx + sx * (H - 1.0), lot.cz + sz * (H - 1.0), Math.atan2(sx, sz));
}
