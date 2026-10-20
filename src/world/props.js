// Street furniture, trees and other props. Static things go straight into chunk geometry;
// breakable things are described as instances so they can be smashed later.
import { PALETTE } from '../config.js';
import { GeomBuilder, shade } from '../render/geometry.js';

/** Breakable prop catalogue: geometry built once at the origin, instanced across the city. */
export const PROP_TYPES = {
  lamp: { radius: 0.22, height: 5.8, strength: 7.5, mass: 180, debris: [PALETTE.lampPost, PALETTE.lampHead], build(gb) {
    gb.cylinder(0, 0, 5.4, 0, 0.1, 0.08, 7, PALETTE.lampPost);
    gb.cylinder(0, 0, 0.5, 0, 0.2, 0.12, 7, PALETTE.lampPost);
    gb.box(0, 5.4, 0.8, 0.12, 0.12, 1.7, PALETTE.lampPost);
    gb.box(0, 5.32, 1.6, 0.42, 0.22, 0.8, PALETTE.lampPost);
    gb.box(0, 5.2, 1.6, 0.34, 0.04, 0.7, PALETTE.lampHead);
  } },
  hydrant: { radius: 0.22, height: 0.8, strength: 2.5, mass: 60, debris: [PALETTE.hydrant], build(gb) {
    gb.cylinder(0, 0, 0.62, 0, 0.17, 0.15, 7, PALETTE.hydrant);
    gb.cylinder(0, 0.62, 0.82, 0, 0.17, 0.05, 7, PALETTE.hydrant);
    gb.box(0, 0.42, 0, 0.56, 0.14, 0.14, PALETTE.hydrant);
    gb.cylinder(0, 0.0, 0.08, 0, 0.26, 0.26, 7, shade(PALETTE.hydrant, 0.8));
  } },
  bench: { radius: 0.9, height: 0.9, strength: 2.0, mass: 50, debris: [PALETTE.bench, 0x3b3747], build(gb) {
    gb.box(0, 0.46, 0, 1.8, 0.08, 0.5, PALETTE.bench);
    gb.box(0, 0.8, -0.22, 1.8, 0.4, 0.07, PALETTE.bench);
    for (const s of [-0.75, 0.75]) { gb.box(s, 0.22, 0.08, 0.08, 0.44, 0.44, 0x3b3747); gb.box(s, 0.62, -0.22, 0.08, 0.36, 0.08, 0x3b3747); }
  } },
  trash: { radius: 0.32, height: 0.95, strength: 1.5, mass: 30, debris: [0x3f6b4f], build(gb) {
    gb.cylinder(0, 0, 0.9, 0, 0.3, 0.33, 8, 0x3f6b4f, { capColor: 0x2e4e3a });
    gb.cylinder(0, 0.9, 0.97, 0, 0.35, 0.35, 8, 0x2e4e3a);
  } },
  mailbox: { radius: 0.35, height: 1.2, strength: 1.5, mass: 40, debris: [0x2f5fb3], build(gb) {
    gb.box(0, 0.2, 0, 0.5, 0.4, 0.5, 0x2f5fb3);
    gb.box(0, 0.75, 0, 0.7, 0.7, 0.6, 0x2f5fb3);
    gb.frustum(0, 1.1, 1.3, 0, 0.7, 0.6, 0.5, 0.4, 0x2f5fb3);
  } },
  bollard: { radius: 0.16, height: 0.95, strength: 4.0, mass: 90, debris: [0x3b3747, 0xf1c15a], build(gb) {
    gb.cylinder(0, 0, 0.95, 0, 0.15, 0.13, 7, 0x3b3747);
    gb.cylinder(0, 0.65, 0.8, 0, 0.152, 0.14, 7, 0xf1c15a);
  } },
  fence: { radius: 2.0, height: 1.0, strength: 1.2, mass: 25, debris: [0xfff6e6], build(gb) {
    for (let x = -1.8; x <= 1.8; x += 0.45) gb.box(x, 0.5, 0, 0.1, 1.0, 0.05, 0xfff6e6);
    gb.box(0, 0.35, 0, 4.0, 0.08, 0.06, 0xfff6e6);
    gb.box(0, 0.8, 0, 4.0, 0.08, 0.06, 0xfff6e6);
  } },
  sign: { radius: 0.15, height: 2.6, strength: 2.0, mass: 35, debris: [0x3b3747, 0x3a8a4a], build(gb) {
    gb.cylinder(0, 0, 2.5, 0, 0.06, 0.05, 5, 0x3b3747);
    gb.box(0, 2.35, 0.4, 0.06, 0.3, 0.9, 0x3a8a4a);
    gb.box(0.03, 2.35, 0.4, 0.015, 0.1, 0.7, 0xfff6e6);
  } },
  cone: { radius: 0.25, height: 0.7, strength: 0.4, mass: 4, debris: [0xff7a1a], build(gb) {
    gb.cylinder(0, 0, 0.7, 0, 0.22, 0.05, 7, 0xff7a1a, { capColor: 0xff7a1a });
    gb.box(0, 0.03, 0, 0.5, 0.06, 0.5, 0xff7a1a);
    gb.cylinder(0, 0.3, 0.42, 0, 0.165, 0.13, 7, 0xfff6e6);
  } },
  newsbox: { radius: 0.3, height: 1.2, strength: 1.5, mass: 35, debris: [0xe84a3c], build(gb) {
    gb.box(0, 0.6, 0, 0.5, 1.2, 0.5, 0xe84a3c);
    gb.box(0, 0.85, 0.26, 0.4, 0.4, 0.02, PALETTE.windowDark);
  } },
};

export function buildPropGeometries() {
  const out = {};
  for (const [name, def] of Object.entries(PROP_TYPES)) {
    const gb = new GeomBuilder();
    def.build(gb);
    out[name] = gb.build();
  }
  return out;
}

/** Trees: static geometry + a trunk collider. type: 'round' | 'tall' | 'pine' | 'palm' | 'bush' */
export function tree(gb, rng, x, z, opts = {}) {
  const type = opts.type || rng.weighted([['round', 5], ['tall', 3], ['pine', 1.5]]);
  const y0 = opts.y0 ?? 0.15;
  const scale = opts.scale ?? rng.range(0.85, 1.25);
  const foliage = opts.color ?? (rng.chance(0.14) ? rng.pick([0xf0a33c, 0xe6793a, 0xf7c85a]) : rng.pick([0x5fb24c, 0x74c25a, 0x4ea04a, 0x9bc94a, 0x58a85a]));
  const trunk = rng.chance(0.5) ? PALETTE.trunk : PALETTE.trunkDark;
  if (type === 'pine') {
    const h = 2.2 * scale;
    gb.cylinder(x, y0, y0 + h, z, 0.22 * scale, 0.16 * scale, 6, trunk);
    let y = y0 + h * 0.55, r = 2.1 * scale;
    for (let i = 0; i < 3; i++) { gb.cylinder(x, y, y + 2.4 * scale, z, r, 0.05, 7, shade(foliage, 0.85 + i * 0.08), { phase: i * 0.4 }); y += 1.5 * scale; r *= 0.72; }
  } else if (type === 'palm') {
    const h = rng.range(5, 8) * scale;
    const lean = rng.range(-0.08, 0.08), leanZ = rng.range(-0.08, 0.08);
    const segs = 4;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      gb.frustum(x + lean * h * t0, y0 + h * t0, y0 + h * t1, z + leanZ * h * t0, 0.5 - 0.1 * t0, 0.5 - 0.1 * t0, 0.5 - 0.1 * t1, 0.5 - 0.1 * t1, i % 2 ? PALETTE.trunk : shade(PALETTE.trunk, 0.88), { ox: lean * h / segs, oz: leanZ * h / segs });
    }
    const tx = x + lean * h, tz = z + leanZ * h, ty = y0 + h;
    gb.icosphere(tx, ty, tz, 0.5, 0, 0x7a5236);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const len = rng.range(2.6, 3.6) * scale;
      const dx = Math.cos(a), dz = Math.sin(a);
      const droop = rng.range(0.9, 1.5);
      const c = [tx, ty - 1, tz];
      // frond as two quads: rises then droops
      const p0 = [tx, ty + 0.1, tz];
      const p1 = [tx + dx * len * 0.45, ty + 0.9, tz + dz * len * 0.45];
      const p2 = [tx + dx * len, ty + 0.9 - droop, tz + dz * len];
      const w = 0.55 * scale;
      const nx = -dz * w, nz = dx * w;
      const fc = shade(foliage, rng.range(0.85, 1.05));
      gb.quadOut([p0[0] - nx * 0.3, p0[1], p0[2] - nz * 0.3], [p0[0] + nx * 0.3, p0[1], p0[2] + nz * 0.3], [p1[0] + nx, p1[1], p1[2] + nz], [p1[0] - nx, p1[1], p1[2] - nz], fc, c);
      gb.quadOut([p1[0] - nx, p1[1], p1[2] - nz], [p1[0] + nx, p1[1], p1[2] + nz], [p2[0] + nx * 0.2, p2[1], p2[2] + nz * 0.2], [p2[0] - nx * 0.2, p2[1], p2[2] - nz * 0.2], fc, c);
      // undersides
      gb.quadOut([p0[0] - nx * 0.3, p0[1] - 0.02, p0[2] - nz * 0.3], [p0[0] + nx * 0.3, p0[1] - 0.02, p0[2] + nz * 0.3], [p1[0] + nx, p1[1] - 0.02, p1[2] + nz], [p1[0] - nx, p1[1] - 0.02, p1[2] - nz], shade(fc, 0.7), [tx, ty + 30, tz]);
      gb.quadOut([p1[0] - nx, p1[1] - 0.02, p1[2] - nz], [p1[0] + nx, p1[1] - 0.02, p1[2] + nz], [p2[0] + nx * 0.2, p2[1] - 0.02, p2[2] + nz * 0.2], [p2[0] - nx * 0.2, p2[1] - 0.02, p2[2] - nz * 0.2], shade(fc, 0.7), [tx, ty + 30, tz]);
    }
    return { x, z, r: 0.5, h };
  } else if (type === 'bush') {
    gb.icosphere(x, y0 + 0.6 * scale, z, 0.9 * scale, 1, foliage, { jitter: 0.12, rng, scale: [1, 0.75, 1] });
    return null;
  } else {
    const trunkH = (type === 'tall' ? 3.2 : 2.2) * scale;
    gb.cylinder(x, y0, y0 + trunkH + 0.5, z, 0.24 * scale, 0.17 * scale, 6, trunk);
    const r = (type === 'tall' ? 1.8 : 2.3) * scale;
    gb.icosphere(x, y0 + trunkH + r * 0.8, z, r, 1, foliage, { jitter: 0.09, rng, scale: [1, type === 'tall' ? 1.25 : 0.95, 1] });
    if (type === 'tall') gb.icosphere(x + 0.3 * scale, y0 + trunkH + r * 1.9, z - 0.2 * scale, r * 0.7, 1, shade(foliage, 1.08), { jitter: 0.1, rng });
  }
  return { x, z, r: 0.3 * scale, h: 3 };
}

/** Bus shelter (static): posts + roof + bench. Facing +z by default, rotated by yaw. */
export function busShelter(gb, x, z, yaw) {
  gb.place(x, 0.15, z, yaw);
  for (const sx of [-1.9, 1.9]) gb.box(sx, 1.3, -0.9, 0.12, 2.6, 0.12, PALETTE.lampPost);
  gb.box(0, 2.65, -0.3, 4.4, 0.14, 1.9, 0xe84a3c);
  gb.box(0, 1.2, -0.95, 4.1, 2.2, 0.06, 0x8fd0c9);
  gb.box(0, 0.5, -0.5, 3.2, 0.08, 0.45, PALETTE.bench);
  gb.clearTransform();
}

/** Concrete planter with a bush (static, solid). */
export function planter(gb, rng, x, z, w = 1.6, d = 1.6) {
  gb.box(x, 0.15 + 0.3, z, w, 0.6, d, PALETTE.planter, { noBottom: true });
  gb.box(x, 0.15 + 0.6, z, w - 0.3, 0.02, d - 0.3, 0x6b4a2e);
  const bushC = rng.pick([0x5fb24c, 0x74c25a, 0xf06292, 0xf3c53d]);
  gb.icosphere(x, 1.05, z, Math.min(w, d) * 0.45, 1, bushC, { jitter: 0.12, rng, scale: [1, 0.7, 1] });
}
