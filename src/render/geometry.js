// GeomBuilder: accumulates flat-shaded, vertex-colored triangles and bakes them into one
// non-indexed BufferGeometry. Every face gets its own normal, so the result is crisp
// low-poly with a single material — no textures, no per-object draw calls.
import * as THREE from 'three';

const _c = new THREE.Color();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

export function rgb(color) {
  if (Array.isArray(color)) return color;
  _c.set(color);
  return [_c.r, _c.g, _c.b];
}

/** Multiply a hex color's brightness (in sRGB-ish terms) and return a new hex. */
export function shade(hex, f) {
  _c.set(hex);
  _c.convertLinearToSRGB();
  _c.r = Math.min(1, _c.r * f); _c.g = Math.min(1, _c.g * f); _c.b = Math.min(1, _c.b * f);
  _c.convertSRGBToLinear();
  return _c.getHex();
}

export class GeomBuilder {
  constructor() {
    this.pos = [];
    this.col = [];
    this.m = null;
    this.triCount = 0;
  }

  /** Apply a transform to everything pushed until clearTransform(). */
  setTransform(matrix) { this.m = matrix; return this; }
  place(x, y, z, rotY = 0, scale = 1) {
    this.m = new THREE.Matrix4().makeRotationY(rotY);
    if (scale !== 1) this.m.scale(new THREE.Vector3(scale, scale, scale));
    this.m.setPosition(x, y, z);
    return this;
  }
  clearTransform() { this.m = null; return this; }

  _push(x, y, z) {
    if (this.m) { _v.set(x, y, z).applyMatrix4(this.m); this.pos.push(_v.x, _v.y, _v.z); }
    else this.pos.push(x, y, z);
  }

  tri(a, b, c, color) {
    const [r, g, bl] = rgb(color);
    this._push(a[0], a[1], a[2]); this._push(b[0], b[1], b[2]); this._push(c[0], c[1], c[2]);
    this.col.push(r, g, bl, r, g, bl, r, g, bl);
    this.triCount++;
  }

  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }

  /** quad whose winding is fixed so the normal points away from `center` */
  quadOut(a, b, c, d, color, center) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_a, _b);
    const fx = (a[0] + c[0]) / 2 - center[0], fy = (a[1] + c[1]) / 2 - center[1], fz = (a[2] + c[2]) / 2 - center[2];
    if (_n.x * fx + _n.y * fy + _n.z * fz < 0) this.quad(a, d, c, b, color);
    else this.quad(a, b, c, d, color);
  }
  triOut(a, b, c, color, center) {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _n.crossVectors(_a, _b);
    const fx = (a[0] + b[0] + c[0]) / 3 - center[0], fy = (a[1] + b[1] + c[1]) / 3 - center[1], fz = (a[2] + b[2] + c[2]) / 3 - center[2];
    if (_n.x * fx + _n.y * fy + _n.z * fz < 0) this.tri(a, c, b, color);
    else this.tri(a, b, c, color);
  }

  /** Axis-aligned box centered at (cx,cy,cz). opts: {top, bottom, sides(array of 4 colors +x,-x,+z,-z), rotY} */
  box(cx, cy, cz, sx, sy, sz, color, opts = {}) {
    this.frustum(cx, cy - sy / 2, cy + sy / 2, cz, sx, sz, sx, sz, color, opts);
  }

  /**
   * Tapered box: bottom rectangle bw×bd at y0, top rectangle tw×td at y1, top offset by (ox,oz).
   * opts: {top, bottom, rotY, ox, oz, noBottom, noTop, sides}
   */
  frustum(cx, y0, y1, cz, bw, bd, tw, td, color, opts = {}) {
    const ox = opts.ox || 0, oz = opts.oz || 0;
    const rot = opts.rotY || 0;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const R = (x, z) => [cx + x * cos + z * sin, cz - x * sin + z * cos];
    const P = (x, y, z) => { const [X, Z] = R(x, z); return [X, y, Z]; };
    const b0 = P(-bw / 2, y0, -bd / 2), b1 = P(bw / 2, y0, -bd / 2), b2 = P(bw / 2, y0, bd / 2), b3 = P(-bw / 2, y0, bd / 2);
    const t0 = P(ox - tw / 2, y1, oz - td / 2), t1 = P(ox + tw / 2, y1, oz - td / 2), t2 = P(ox + tw / 2, y1, oz + td / 2), t3 = P(ox - tw / 2, y1, oz + td / 2);
    const center = [cx + (ox * cos) / 2, (y0 + y1) / 2, cz + (oz * cos) / 2];
    const sides = opts.sides;
    if (!opts.noTop) this.quadOut(t0, t1, t2, t3, opts.top ?? color, center);
    if (!opts.noBottom) this.quadOut(b0, b1, b2, b3, opts.bottom ?? color, center);
    this.quadOut(b1, b2, t2, t1, sides ? sides[0] : color, center); // +x
    this.quadOut(b3, b0, t0, t3, sides ? sides[1] : color, center); // -x
    this.quadOut(b2, b3, t3, t2, sides ? sides[2] : color, center); // +z
    this.quadOut(b0, b1, t1, t0, sides ? sides[3] : color, center); // -z
  }

  /** Flat quad facing +Y at height y. */
  slab(cx, y, cz, sx, sz, color, rotY = 0) {
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const R = (x, z) => [cx + x * cos + z * sin, y, cz - x * sin + z * cos];
    this.quadOut(R(-sx / 2, -sz / 2), R(sx / 2, -sz / 2), R(sx / 2, sz / 2), R(-sx / 2, sz / 2), color, [cx, y - 1, cz]);
  }

  /** Vertical cylinder/cone between y0 and y1. opts: {capTop, capBottom, capColor, phase} */
  cylinder(cx, y0, y1, cz, r0, r1, seg, color, opts = {}) {
    const phase = opts.phase || 0;
    const center = [cx, (y0 + y1) / 2, cz];
    const ring = (y, r) => { const pts = []; for (let i = 0; i < seg; i++) { const a = phase + (i / seg) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); } return pts; };
    const lo = ring(y0, r0), hi = ring(y1, r1);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      if (r1 <= 1e-6) this.triOut(lo[i], lo[j], [cx, y1, cz], color, center);
      else if (r0 <= 1e-6) this.triOut([cx, y0, cz], hi[j], hi[i], color, center);
      else this.quadOut(lo[i], lo[j], hi[j], hi[i], color, center);
    }
    const capColor = opts.capColor ?? color;
    if (opts.capTop !== false && r1 > 1e-6) for (let i = 0; i < seg; i++) this.triOut([cx, y1, cz], hi[i], hi[(i + 1) % seg], capColor, center);
    if (opts.capBottom && r0 > 1e-6) for (let i = 0; i < seg; i++) this.triOut([cx, y0, cz], lo[i], lo[(i + 1) % seg], capColor, center);
  }

  /** Cylinder along the X axis (wheels, pipes). Center (cx,cy,cz), radius r, length len. */
  cylinderX(cx, cy, cz, r, len, seg, color, opts = {}) {
    const center = [cx, cy, cz];
    const ring = (x) => { const pts = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push([x, cy + Math.cos(a) * r, cz + Math.sin(a) * r]); } return pts; };
    const lo = ring(cx - len / 2), hi = ring(cx + len / 2);
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; this.quadOut(lo[i], lo[j], hi[j], hi[i], color, center); }
    const capColor = opts.capColor ?? color;
    const capR = opts.capRadius ?? r;
    if (capR !== r) {
      // inset cap (hub): ring at capR then disc
      const ringC = (x) => { const pts = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push([x, cy + Math.cos(a) * capR, cz + Math.sin(a) * capR]); } return pts; };
      const inset = opts.capInset ?? 0;
      const loC = ringC(cx - len / 2 + inset), hiC = ringC(cx + len / 2 - inset);
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        this.quadOut(lo[i], lo[j], loC[j], loC[i], color, center);
        this.quadOut(hi[i], hi[j], hiC[j], hiC[i], color, center);
        this.triOut([cx - len / 2 + inset, cy, cz], loC[i], loC[j], capColor, center);
        this.triOut([cx + len / 2 - inset, cy, cz], hiC[i], hiC[j], capColor, center);
      }
    } else {
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        this.triOut([cx - len / 2, cy, cz], lo[i], lo[j], capColor, center);
        this.triOut([cx + len / 2, cy, cz], hi[i], hi[j], capColor, center);
      }
    }
  }

  /** Flat disc facing +Y */
  disc(cx, y, cz, r, seg, color) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      this.triOut([cx, y, cz], [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r], color, [cx, y - 1, cz]);
    }
  }

  /**
   * Gable roof: triangular prism with ridge along X (or Z if alongZ). Base rectangle w×d at y0,
   * ridge height h. opts: {alongZ, overhang, bottom, endColor}
   */
  gable(cx, y0, cz, w, d, h, color, opts = {}) {
    const rot = opts.alongZ ? Math.PI / 2 : 0;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const R = (x, y, z) => [cx + x * cos + z * sin, y, cz - x * sin + z * cos];
    const hw = w / 2, hd = d / 2;
    const center = [cx, y0 + h / 3, cz];
    const a = R(-hw, y0, -hd), b = R(hw, y0, -hd), c = R(hw, y0, hd), dd = R(-hw, y0, hd);
    const r0 = R(-hw, y0 + h, 0), r1 = R(hw, y0 + h, 0);
    this.quadOut(a, b, r1, r0, color, center);          // slope -z side
    this.quadOut(dd, c, r1, r0, color, center);         // slope +z side
    this.triOut(a, dd, r0, opts.endColor ?? color, center);
    this.triOut(b, c, r1, opts.endColor ?? color, center);
    if (opts.bottom) this.quadOut(a, b, c, dd, opts.bottom, center);
  }

  /** Low-poly sphere. detail 0 = 20 faces, 1 = 80, 2 = 320. opts: {jitter, rng, scale:[sx,sy,sz]} */
  icosphere(cx, cy, cz, r, detail, color, opts = {}) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map((v) => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; });
    let faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    for (let s = 0; s < detail; s++) {
      const nf = [];
      const cache = new Map();
      const mid = (i, j) => {
        const key = i < j ? `${i}_${j}` : `${j}_${i}`;
        if (cache.has(key)) return cache.get(key);
        const a = verts[i], b = verts[j];
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        const l = Math.hypot(...m);
        verts.push([m[0] / l, m[1] / l, m[2] / l]);
        cache.set(key, verts.length - 1);
        return verts.length - 1;
      };
      for (const [a, b, c] of faces) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = nf;
    }
    const sc = opts.scale || [1, 1, 1];
    const jit = opts.jitter || 0;
    const rng = opts.rng;
    const pts = verts.map((v) => {
      const j = jit && rng ? 1 + (rng.next() - 0.5) * 2 * jit : 1;
      return [cx + v[0] * r * sc[0] * j, cy + v[1] * r * sc[1] * j, cz + v[2] * r * sc[2] * j];
    });
    const center = [cx, cy, cz];
    for (const [a, b, c] of faces) this.triOut(pts[a], pts[b], pts[c], color, center);
  }

  /** Append another builder's data (optionally transformed by this.m). */
  append(other) {
    for (let i = 0; i < other.pos.length; i += 3) this._push(other.pos[i], other.pos[i + 1], other.pos[i + 2]);
    for (let i = 0; i < other.col.length; i++) this.col.push(other.col[i]);
    this.triCount += other.triCount;
  }

  isEmpty() { return this.pos.length === 0; }

  build() {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(this.pos);
    const nrm = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
      const bx = pos[i + 3] - ax, by = pos[i + 4] - ay, bz = pos[i + 5] - az;
      const cx = pos[i + 6] - ax, cy = pos[i + 7] - ay, cz = pos[i + 8] - az;
      let nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) { nrm[i + k * 3] = nx; nrm[i + k * 3 + 1] = ny; nrm[i + k * 3 + 2] = nz; }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

/** Recompute flat normals in place after vertices moved (used for crash dents). */
export function recomputeFlatNormals(geo) {
  const pos = geo.attributes.position.array;
  const nrm = geo.attributes.normal.array;
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const bx = pos[i + 3] - ax, by = pos[i + 4] - ay, bz = pos[i + 5] - az;
    const cx = pos[i + 6] - ax, cy = pos[i + 7] - ay, cz = pos[i + 8] - az;
    let nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) { nrm[i + k * 3] = nx; nrm[i + k * 3 + 1] = ny; nrm[i + k * 3 + 2] = nz; }
  }
  geo.attributes.normal.needsUpdate = true;
}
