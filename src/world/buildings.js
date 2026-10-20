// Procedural low-poly buildings: color-blocked facades, window quads, cornices, awnings,
// rooftop clutter, gable-roofed houses. Everything is pushed into a GeomBuilder.
import { PALETTE } from '../config.js';
import { shade } from '../render/geometry.js';

/** length of a footprint side: sides 0 (+x) and 2 (-x) run along z; 1 (+z) and 3 (-z) along x */
const sideLen = (fp, side) => (side % 2 === 0 ? fp.z1 - fp.z0 : fp.x1 - fp.x0);
const center = (fp) => [(fp.x0 + fp.x1) / 2, 0, (fp.z0 + fp.z1) / 2];

/** point on the wall `side` at parametric distance u along it, pushed out by `off` */
function wallPoint(fp, side, u, y, off) {
  switch (side) {
    case 0: return [fp.x1 + off, y, fp.z0 + u];
    case 1: return [fp.x0 + u, y, fp.z1 + off];
    case 2: return [fp.x0 - off, y, fp.z0 + u];
    default: return [fp.x0 + u, y, fp.z0 - off];
  }
}

export function wallQuad(gb, fp, side, u0, u1, y0, y1, off, color) {
  const c = center(fp);
  gb.quadOut(wallPoint(fp, side, u0, y0, off), wallPoint(fp, side, u1, y0, off), wallPoint(fp, side, u1, y1, off), wallPoint(fp, side, u0, y1, off), color, c);
}

/** a box protruding `depth` from the wall between u0..u1 and y0..y1 */
export function wallBox(gb, fp, side, u0, u1, y0, y1, depth, color, opts = {}) {
  const inset = opts.inset || 0.02; // sink into wall so there is no gap
  const a = wallPoint(fp, side, (u0 + u1) / 2, (y0 + y1) / 2, depth / 2 - inset);
  const w = u1 - u0, h = y1 - y0;
  if (side % 2 === 0) gb.box(a[0], a[1], a[2], depth + inset, h, w, color, opts);
  else gb.box(a[0], a[1], a[2], w, h, depth + inset, color, opts);
}

function windowGrid(gb, rng, fp, side, yStart, yEnd, floorH, color, litColor, opts = {}) {
  const len = sideLen(fp, side);
  const ww = opts.ww || 1.3, wh = opts.wh || 1.5, spacing = opts.spacing || 3.4, margin = opts.margin || 1.6;
  const count = Math.max(1, Math.floor((len - 2 * margin) / spacing));
  const start = (len - (count - 1) * spacing) / 2;
  const floors = Math.floor((yEnd - yStart) / floorH);
  for (let f = 0; f < floors; f++) {
    const y0 = yStart + f * floorH + (floorH - wh) / 2 + 0.1;
    if (opts.band) {
      // continuous glass band per floor
      wallQuad(gb, fp, side, margin * 0.5, len - margin * 0.5, y0, y0 + wh, 0.03, color);
      continue;
    }
    for (let k = 0; k < count; k++) {
      const u = start + k * spacing;
      const c = rng.chance(opts.litChance ?? 0.12) ? litColor : color;
      if (opts.frame) wallQuad(gb, fp, side, u - ww / 2 - 0.1, u + ww / 2 + 0.1, y0 - 0.1, y0 + wh + 0.1, 0.025, opts.frame);
      wallQuad(gb, fp, side, u - ww / 2, u + ww / 2, y0, y0 + wh, 0.04, c);
      if (opts.sill) wallBox(gb, fp, side, u - ww / 2 - 0.1, u + ww / 2 + 0.1, y0 - 0.12, y0, 0.14, opts.sill);
    }
  }
}

function roofClutter(gb, rng, fp, yTop, bodyColor) {
  const w = fp.x1 - fp.x0, d = fp.z1 - fp.z0;
  const cx = (fp.x0 + fp.x1) / 2, cz = (fp.z0 + fp.z1) / 2;
  const items = rng.int(1, 3);
  for (let i = 0; i < items; i++) {
    const px = cx + rng.range(-w / 2 + 2.5, w / 2 - 2.5), pz = cz + rng.range(-d / 2 + 2.5, d / 2 - 2.5);
    const kind = rng.int(0, 4);
    if (kind === 0) { // AC unit
      gb.box(px, yTop + 0.55, pz, 1.6, 1.1, 1.3, 0xb9b4bf);
      gb.disc(px, yTop + 1.11, pz, 0.5, 8, 0x5a5563);
    } else if (kind === 1) { // water tank on legs
      gb.cylinder(px, yTop, yTop + 1.4, pz, 0.08, 0.08, 4, 0x3b3747);
      gb.cylinder(px, yTop + 1.4, yTop + 3.4, pz, 1.1, 1.1, 8, 0x9a6a4a);
      gb.cylinder(px, yTop + 3.4, yTop + 4.0, pz, 1.1, 0.2, 8, 0x7a5236);
    } else if (kind === 2) { // stair bulkhead
      gb.box(px, yTop + 1.3, pz, 3.2, 2.6, 2.6, shade(bodyColor, 0.9));
    } else if (kind === 3) { // antenna
      gb.cylinder(px, yTop, yTop + rng.range(3, 6), pz, 0.08, 0.05, 4, 0x3b3747);
    } else { // rooftop sign slab
      const col = rng.pick(PALETTE.awning);
      gb.box(px, yTop + 1.4, pz, rng.chance(0.5) ? 4.5 : 0.3, 1.6, rng.chance(0.5) ? 0.3 : 4.5, col);
    }
  }
}

/**
 * Generic urban building. spec: {fp:{x0,z0,x1,z1}, y0, height, style, color, trim, roof, streetSides:[], rng}
 * styles: 'shop' | 'apartment' | 'office' | 'tower' | 'warehouse'
 */
export function buildBuilding(gb, rng, spec) {
  const { fp, style } = spec;
  const y0 = spec.y0 ?? 0.14;
  const h = spec.height;
  const color = spec.color;
  const trim = spec.trim ?? rng.pick(PALETTE.trims);
  const cx = (fp.x0 + fp.x1) / 2, cz = (fp.z0 + fp.z1) / 2;
  const w = fp.x1 - fp.x0, d = fp.z1 - fp.z0;
  const streetSides = spec.streetSides || [1];
  const win = PALETTE.windowDark, lit = PALETTE.windowLit;

  if (style === 'tower') {
    const glass = spec.color;
    const podiumH = 8;
    const pw = w, pd = d;
    // podium
    gb.box(cx, y0 + podiumH / 2, cz, pw, podiumH, pd, shade(color, 0.72), { noBottom: true });
    for (const s of [0, 1, 2, 3]) windowGrid(gb, rng, { x0: fp.x0, z0: fp.z0, x1: fp.x1, z1: fp.z1 }, s, y0 + 0.6, y0 + podiumH, 3.6, win, lit, { band: true, wh: 2.2 });
    // shaft with optional setback
    const inset = rng.range(2.5, 4.5);
    const sfp = { x0: fp.x0 + inset, z0: fp.z0 + inset, x1: fp.x1 - inset, z1: fp.z1 - inset };
    const sw = sfp.x1 - sfp.x0, sd = sfp.z1 - sfp.z0;
    const setback = rng.chance(0.55);
    const h1 = setback ? y0 + podiumH + (h - podiumH) * rng.range(0.55, 0.75) : y0 + h;
    gb.box(cx, (y0 + podiumH + h1) / 2, cz, sw, h1 - y0 - podiumH, sd, glass, { noBottom: true, top: trim });
    // vertical fins
    const finColor = trim;
    for (const s of [0, 1, 2, 3]) {
      const len = sideLen(sfp, s);
      const n = Math.max(2, Math.floor(len / 3.2));
      for (let k = 0; k <= n; k++) {
        const u = (k / n) * len;
        wallBox(gb, sfp, s, Math.max(0, u - 0.18), Math.min(len, u + 0.18), y0 + podiumH, h1, 0.25, finColor);
      }
      // horizontal floor lines as darker bands
      for (let y = y0 + podiumH + 3.6; y < h1 - 1; y += 3.6) wallQuad(gb, sfp, s, 0, len, y - 0.18, y + 0.18, 0.03, shade(glass, 0.75));
    }
    if (setback) {
      const in2 = rng.range(2, 3.5);
      const tfp = { x0: sfp.x0 + in2, z0: sfp.z0 + in2, x1: sfp.x1 - in2, z1: sfp.z1 - in2 };
      const tw = tfp.x1 - tfp.x0, td = tfp.z1 - tfp.z0;
      gb.box(cx, (h1 + y0 + h) / 2, cz, tw, y0 + h - h1, td, glass, { noBottom: true, top: trim });
      for (const s of [0, 1, 2, 3]) {
        const len = sideLen(tfp, s);
        const n = Math.max(2, Math.floor(len / 3.2));
        for (let k = 0; k <= n; k++) { const u = (k / n) * len; wallBox(gb, tfp, s, Math.max(0, u - 0.18), Math.min(len, u + 0.18), h1, y0 + h, 0.25, finColor); }
      }
      // crown
      gb.box(cx, y0 + h + 0.6, cz, tw + 0.6, 1.2, td + 0.6, trim);
      gb.box(cx, y0 + h + 2.2, cz, 2.4, 2.4, 2.4, shade(trim, 0.8));
      gb.cylinder(cx, y0 + h + 3.4, y0 + h + 9 + rng.range(0, 6), cz, 0.2, 0.08, 5, 0x3b3747);
    } else {
      gb.box(cx, h1 + 0.6, cz, sw + 0.6, 1.2, sd + 0.6, trim);
      roofClutter(gb, rng, sfp, h1 + 1.2, color);
    }
    return;
  }

  if (style === 'warehouse') {
    gb.box(cx, y0 + h / 2, cz, w, h, d, color, { noBottom: true, top: shade(color, 0.8) });
    // shallow gable roof with overhang
    gb.gable(cx, y0 + h - 0.05, cz, w + 0.8, d + 0.8, Math.min(3.5, w * 0.12), spec.roof ?? shade(color, 0.7), { alongZ: d > w, endColor: shade(color, 0.85) });
    // big roll-up doors on street sides
    for (const s of streetSides) {
      const len = sideLen(fp, s);
      const doors = Math.max(1, Math.floor(len / 9));
      for (let k = 0; k < doors; k++) {
        const u = (len / doors) * (k + 0.5);
        wallBox(gb, fp, s, u - 2.2, u + 2.2, y0, y0 + 4.2, 0.12, rng.pick(PALETTE.awning));
        wallQuad(gb, fp, s, u - 2.2, u + 2.2, y0 + 4.4, y0 + 5.2, 0.03, win);
      }
    }
    for (const s of [0, 1, 2, 3]) if (!streetSides.includes(s)) windowGrid(gb, rng, fp, s, y0 + 3, y0 + h - 1, 10, win, lit, { ww: 2.4, wh: 1.0, spacing: 5 });
    return;
  }

  // ---- shop / apartment / office: color-blocked facade ----
  const baseH = style === 'office' ? 5.2 : 4.2;
  const bodyTop = y0 + h;
  const baseColor = style === 'office' ? trim : shade(color, 0.8);
  // ground floor band (slightly wider so it reads as a plinth)
  gb.box(cx, y0 + baseH / 2, cz, w + 0.25, baseH, d + 0.25, baseColor, { noBottom: true, noTop: true });
  gb.box(cx, y0 + baseH / 2 + baseH / 2, cz, w + 0.25, 0.01, d + 0.25, baseColor);
  // upper body
  gb.box(cx, (y0 + baseH + bodyTop) / 2, cz, w, bodyTop - y0 - baseH, d, color, { noBottom: true, top: spec.roof ?? shade(color, 0.6) });
  // storefronts + doors + awnings on street sides, plain windows elsewhere
  for (let s = 0; s < 4; s++) {
    const len = sideLen(fp, s);
    if (streetSides.includes(s) && len > 6) {
      if (style === 'office') {
        // glass lobby
        wallQuad(gb, fp, s, 0.8, len - 0.8, y0 + 0.3, y0 + baseH - 0.6, 0.15, win);
        wallBox(gb, fp, s, len / 2 - 1.6, len / 2 + 1.6, y0, y0 + 3.4, 0.5, trim);
        wallQuad(gb, fp, s, len / 2 - 1.2, len / 2 + 1.2, y0, y0 + 3.0, 0.55, PALETTE.door);
      } else {
        const shops = Math.max(1, Math.round(len / 6.5));
        const sw2 = len / shops;
        for (let k = 0; k < shops; k++) {
          const u0 = k * sw2 + 0.5, u1 = (k + 1) * sw2 - 0.5;
          // storefront glass
          wallQuad(gb, fp, s, u0, u1, y0 + 0.4, y0 + 3.1, 0.15, rng.chance(0.3) ? lit : win);
          // door
          const du = rng.chance(0.5) ? u0 + 1.3 : u1 - 1.3;
          wallQuad(gb, fp, s, du - 0.7, du + 0.7, y0, y0 + 2.6, 0.17, PALETTE.door);
          // awning: sloped quad in a bright color
          if (rng.chance(0.75)) {
            const ac = rng.pick(PALETTE.awning);
            const c = center(fp);
            const a0 = wallPoint(fp, s, u0 + 0.2, y0 + 3.3, 0.13), a1 = wallPoint(fp, s, u1 - 0.2, y0 + 3.3, 0.13);
            const b0 = wallPoint(fp, s, u0 + 0.2, y0 + 2.75, 1.7), b1 = wallPoint(fp, s, u1 - 0.2, y0 + 2.75, 1.7);
            gb.quadOut(a0, a1, b1, b0, ac, [c[0], -50, c[2]]);
            // underside (darker) so it is solid from below
            gb.quadOut(a0, a1, b1, b0, shade(ac, 0.6), [c[0], 50, c[2]]);
            // front lip
            const l0 = [b0[0], b0[1] - 0.3, b0[2]], l1 = [b1[0], b1[1] - 0.3, b1[2]];
            gb.quadOut(b0, b1, l1, l0, ac, c);
          } else if (rng.chance(0.5)) {
            // sign board
            wallBox(gb, fp, s, u0 + 0.3, u1 - 0.3, y0 + 3.3, y0 + 4.0, 0.2, rng.pick(PALETTE.awning));
          }
        }
      }
    } else {
      windowGrid(gb, rng, fp, s, y0 + 0.8, y0 + baseH - 0.4, baseH, win, lit, { ww: 1.6, wh: 1.4, spacing: 3.6 });
    }
    // upper floors
    const floorH = style === 'office' ? 3.6 : 3.3;
    if (style === 'office') windowGrid(gb, rng, fp, s, y0 + baseH + 0.4, bodyTop - 0.6, floorH, win, lit, { band: rng.chance(0.5), ww: 1.8, wh: 1.9, spacing: 3.0 });
    else windowGrid(gb, rng, fp, s, y0 + baseH + 0.3, bodyTop - 0.5, floorH, win, lit, { ww: 1.3, wh: 1.5, spacing: 3.4, frame: style === 'apartment' ? 0xfff6e6 : null, sill: style === 'apartment' ? 0xfff6e6 : null });
    // balconies for apartments on street sides
    if (style === 'apartment' && streetSides.includes(s)) {
      const floors = Math.floor((bodyTop - y0 - baseH) / floorH);
      const spacing = 3.4, margin = 1.6;
      const count = Math.max(1, Math.floor((len - 2 * margin) / spacing));
      const start = (len - (count - 1) * spacing) / 2;
      for (let f = 0; f < floors; f++) for (let k = 0; k < count; k++) {
        if ((k + f) % 2) continue;
        const u = start + k * spacing;
        const yb = y0 + baseH + f * floorH + 0.3;
        wallBox(gb, fp, s, u - 1.1, u + 1.1, yb, yb + 0.16, 1.2, 0xfff6e6);
        wallBox(gb, fp, s, u - 1.1, u + 1.1, yb + 0.16, yb + 1.0, 0.08, 0xfff6e6, { inset: -1.1 });
      }
    }
  }
  // cornice + parapet
  gb.box(cx, bodyTop - 0.3, cz, w + 0.5, 0.6, d + 0.5, trim);
  gb.box(cx, bodyTop + 0.35, cz, w + 0.1, 0.7, d + 0.1, shade(color, 0.9), { noBottom: true });
  gb.box(cx, bodyTop + 0.69, cz, w - 0.6, 0.02, d - 0.6, shade(color, 0.6));
  roofClutter(gb, rng, fp, bodyTop + 0.7, color);
}

/** Small residential house with gable roof. spec: {cx, cz, w, d, floors, color, roof, trim, facing (side index toward street)} */
export function buildHouse(gb, rng, spec) {
  const { cx, cz, w, d } = spec;
  const y0 = spec.y0 ?? 0.15;
  const floorH = 3.0;
  const h = spec.floors * floorH + 0.4;
  const color = spec.color, trim = spec.trim ?? 0xfff6e6, roof = spec.roof;
  const fp = { x0: cx - w / 2, z0: cz - d / 2, x1: cx + w / 2, z1: cz + d / 2 };
  gb.box(cx, y0 + h / 2, cz, w, h, d, color, { noBottom: true });
  const alongZ = d > w;
  const roofH = Math.min(w, d) * rng.range(0.32, 0.45);
  gb.gable(cx, y0 + h - 0.3, cz, w + 1.0, d + 1.0, roofH, roof, { alongZ, endColor: shade(roof, 0.9) });
  // fascia board under the eaves
  gb.box(cx, y0 + h - 0.42, cz, w + 1.0, 0.25, d + 1.0, trim, { noTop: true });
  // chimney
  if (rng.chance(0.7)) {
    const chx = cx + (alongZ ? 0 : w * 0.3), chz = cz + (alongZ ? d * 0.3 : 0);
    gb.box(chx, y0 + h + roofH * 0.6, chz, 0.9, roofH * 1.2, 0.9, shade(roof, 0.75));
  }
  // windows with frames
  for (let s = 0; s < 4; s++) {
    const len = sideLen(fp, s);
    const count = Math.max(1, Math.floor(len / 3.2));
    const start = (len - (count - 1) * 3.2) / 2;
    for (let f = 0; f < spec.floors; f++) for (let k = 0; k < count; k++) {
      const u = start + k * 3.2;
      const yb = y0 + f * floorH + 1.0;
      if (s === spec.facing && f === 0 && k === Math.floor(count / 2)) continue; // door spot
      wallQuad(gb, fp, s, u - 0.75, u + 0.75, yb - 0.1, yb + 1.5, 0.03, trim);
      wallQuad(gb, fp, s, u - 0.6, u + 0.6, yb, yb + 1.4, 0.05, rng.chance(0.2) ? PALETTE.windowLit : PALETTE.windowDark);
    }
  }
  // door + porch on the facing side
  const s = spec.facing;
  const len = sideLen(fp, s);
  const du = len / 2;
  wallQuad(gb, fp, s, du - 0.85, du + 0.85, y0, y0 + 2.3, 0.04, trim);
  wallQuad(gb, fp, s, du - 0.65, du + 0.65, y0, y0 + 2.1, 0.06, rng.pick([0x8a4b2f, 0x2f5f8f, 0xd14b3a, 0x2d2a38]));
  // porch roof + posts
  const pc = wallPoint(fp, s, du, y0 + 2.6, 1.3);
  gb.box(pc[0], pc[1], pc[2], s % 2 === 0 ? 2.6 : 3.6, 0.18, s % 2 === 0 ? 3.6 : 2.6, trim);
  for (const side of [-1, 1]) {
    const pp = wallPoint(fp, s, du + side * 1.5, y0, 2.3);
    gb.box(pp[0], y0 + 1.3, pp[2], 0.18, 2.6, 0.18, trim);
  }
  const step = wallPoint(fp, s, du, y0 + 0.08, 1.4);
  gb.box(step[0], step[1], step[2], s % 2 === 0 ? 2.8 : 4.0, 0.16, s % 2 === 0 ? 4.0 : 2.8, shade(trim, 0.9));
}
