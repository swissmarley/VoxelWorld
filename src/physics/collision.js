// 2D rigid-body collision helpers for the flat city: oriented boxes (cars), axis-aligned
// boxes (buildings, walls) and circles (props, player). Forward of a box with yaw θ is
// (sin θ, cos θ); its right side is (-cos θ, sin θ).

export function obbFromAABB(c, out = {}) {
  out.x = (c.x0 + c.x1) / 2; out.z = (c.z0 + c.z1) / 2; out.yaw = 0;
  out.hl = (c.z1 - c.z0) / 2; out.hw = (c.x1 - c.x0) / 2;
  return out;
}

const _corners = [[0, 0], [0, 0], [0, 0], [0, 0]];
const _cornersB = [[0, 0], [0, 0], [0, 0], [0, 0]];
export function obbCorners(o, out = _corners) {
  const fx = Math.sin(o.yaw), fz = Math.cos(o.yaw), rx = -Math.cos(o.yaw), rz = Math.sin(o.yaw);
  out[0][0] = o.x + fx * o.hl + rx * o.hw; out[0][1] = o.z + fz * o.hl + rz * o.hw;
  out[1][0] = o.x + fx * o.hl - rx * o.hw; out[1][1] = o.z + fz * o.hl - rz * o.hw;
  out[2][0] = o.x - fx * o.hl - rx * o.hw; out[2][1] = o.z - fz * o.hl - rz * o.hw;
  out[3][0] = o.x - fx * o.hl + rx * o.hw; out[3][1] = o.z - fz * o.hl + rz * o.hw;
  return out;
}

const _axes = [[0, 0], [0, 0], [0, 0], [0, 0]];
/**
 * SAT test between two oriented boxes. On overlap fills res = {nx, nz, depth, px, pz}
 * with the normal pointing from a to b and the contact point, and returns true.
 */
export function collideOBB(a, b, res) {
  const ca = obbCorners(a, _corners), cb = obbCorners(b, _cornersB);
  _axes[0][0] = Math.sin(a.yaw); _axes[0][1] = Math.cos(a.yaw);
  _axes[1][0] = -Math.cos(a.yaw); _axes[1][1] = Math.sin(a.yaw);
  _axes[2][0] = Math.sin(b.yaw); _axes[2][1] = Math.cos(b.yaw);
  _axes[3][0] = -Math.cos(b.yaw); _axes[3][1] = Math.sin(b.yaw);
  let minDepth = Infinity, minAxis = -1, minSign = 1;
  for (let i = 0; i < 4; i++) {
    const ax = _axes[i][0], az = _axes[i][1];
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (let k = 0; k < 4; k++) {
      const pa = ca[k][0] * ax + ca[k][1] * az; if (pa < aMin) aMin = pa; if (pa > aMax) aMax = pa;
      const pb = cb[k][0] * ax + cb[k][1] * az; if (pb < bMin) bMin = pb; if (pb > bMax) bMax = pb;
    }
    if (aMax < bMin || bMax < aMin) return false;
    const d1 = aMax - bMin, d2 = bMax - aMin;
    const depth = Math.min(d1, d2);
    if (depth < minDepth) { minDepth = depth; minAxis = i; minSign = d1 < d2 ? 1 : -1; }
  }
  let nx = _axes[minAxis][0] * minSign, nz = _axes[minAxis][1] * minSign;
  // normal must point from a to b
  if ((b.x - a.x) * nx + (b.z - a.z) * nz < 0) { nx = -nx; nz = -nz; }
  // contact point: deepest vertex of the incident box
  let px, pz;
  if (minAxis < 2) {
    let best = Infinity;
    for (let k = 0; k < 4; k++) { const d = (cb[k][0] - a.x) * nx + (cb[k][1] - a.z) * nz; if (d < best) { best = d; px = cb[k][0]; pz = cb[k][1]; } }
  } else {
    let best = -Infinity;
    for (let k = 0; k < 4; k++) { const d = (ca[k][0] - b.x) * nx + (ca[k][1] - b.z) * nz; if (d > best) { best = d; px = ca[k][0]; pz = ca[k][1]; } }
  }
  res.nx = nx; res.nz = nz; res.depth = minDepth; res.px = px; res.pz = pz;
  return true;
}

/** Circle (cx,cz,r) vs OBB. Normal points from the box toward the circle. */
export function collideCircleOBB(cx, cz, r, o, res) {
  const fx = Math.sin(o.yaw), fz = Math.cos(o.yaw), rx = -Math.cos(o.yaw), rz = Math.sin(o.yaw);
  const dx = cx - o.x, dz = cz - o.z;
  const lf = dx * fx + dz * fz, lr = dx * rx + dz * rz;
  const cf = Math.max(-o.hl, Math.min(o.hl, lf)), cr = Math.max(-o.hw, Math.min(o.hw, lr));
  let df = lf - cf, dr = lr - cr;
  let dist = Math.hypot(df, dr);
  if (dist > r) return false;
  let nf, nr, depth;
  if (dist > 1e-6) { nf = df / dist; nr = dr / dist; depth = r - dist; }
  else {
    // center inside the box: push out along the axis of least penetration
    const pf = o.hl - Math.abs(lf), pr = o.hw - Math.abs(lr);
    if (pf < pr) { nf = Math.sign(lf) || 1; nr = 0; depth = pf + r; } else { nf = 0; nr = Math.sign(lr) || 1; depth = pr + r; }
  }
  res.nx = nf * fx + nr * rx; res.nz = nf * fz + nr * rz; res.depth = depth;
  res.px = o.x + cf * fx + cr * rx; res.pz = o.z + cf * fz + cr * rz;
  return true;
}

/** Circle vs AABB {x0,z0,x1,z1}. Normal points from the box toward the circle. */
export function collideCircleAABB(cx, cz, r, c, res) {
  const qx = Math.max(c.x0, Math.min(c.x1, cx)), qz = Math.max(c.z0, Math.min(c.z1, cz));
  let dx = cx - qx, dz = cz - qz;
  const dist = Math.hypot(dx, dz);
  if (dist > r) return false;
  if (dist > 1e-6) { res.nx = dx / dist; res.nz = dz / dist; res.depth = r - dist; }
  else {
    const px0 = cx - c.x0, px1 = c.x1 - cx, pz0 = cz - c.z0, pz1 = c.z1 - cz;
    const m = Math.min(px0, px1, pz0, pz1);
    if (m === px0) { res.nx = -1; res.nz = 0; } else if (m === px1) { res.nx = 1; res.nz = 0; } else if (m === pz0) { res.nx = 0; res.nz = -1; } else { res.nx = 0; res.nz = 1; }
    res.depth = m + r;
  }
  res.px = qx; res.pz = qz;
  return true;
}

/**
 * Resolve a contact between two 2D rigid bodies with an impulse + positional correction.
 * Bodies: {x, z, vx, vz, angVel, invMass, invInertia}. Static bodies use invMass = 0.
 * Returns the normal impulse magnitude (N·s) so callers can derive damage.
 */
export function resolveContact(A, B, nx, nz, depth, px, pz, restitution = 0.25, friction = 0.55) {
  const rax = px - A.x, raz = pz - A.z, rbx = px - B.x, rbz = pz - B.z;
  // velocity of contact points (w × r in 2D: (-w*rz, w*rx))
  const vax = A.vx - A.angVel * raz, vaz = A.vz + A.angVel * rax;
  const vbx = B.vx - B.angVel * rbz, vbz = B.vz + B.angVel * rbx;
  const rvx = vbx - vax, rvz = vbz - vaz;
  const vn = rvx * nx + rvz * nz;
  let jn = 0;
  const raN = rax * nz - raz * nx, rbN = rbx * nz - rbz * nx;
  const kN = A.invMass + B.invMass + raN * raN * A.invInertia + rbN * rbN * B.invInertia;
  if (vn < 0 && kN > 0) {
    jn = -(1 + restitution) * vn / kN;
    A.vx -= jn * nx * A.invMass; A.vz -= jn * nz * A.invMass; A.angVel -= jn * raN * A.invInertia;
    B.vx += jn * nx * B.invMass; B.vz += jn * nz * B.invMass; B.angVel += jn * rbN * B.invInertia;
    // friction along the tangent
    const tx = -nz, tz = nx;
    const vax2 = A.vx - A.angVel * raz, vaz2 = A.vz + A.angVel * rax;
    const vbx2 = B.vx - B.angVel * rbz, vbz2 = B.vz + B.angVel * rbx;
    const vt = (vbx2 - vax2) * tx + (vbz2 - vaz2) * tz;
    const raT = rax * tz - raz * tx, rbT = rbx * tz - rbz * tx;
    const kT = A.invMass + B.invMass + raT * raT * A.invInertia + rbT * rbT * B.invInertia;
    if (kT > 0) {
      let jt = -vt / kT;
      const maxF = Math.abs(jn) * friction;
      if (jt > maxF) jt = maxF; else if (jt < -maxF) jt = -maxF;
      A.vx -= jt * tx * A.invMass; A.vz -= jt * tz * A.invMass; A.angVel -= jt * raT * A.invInertia;
      B.vx += jt * tx * B.invMass; B.vz += jt * tz * B.invMass; B.angVel += jt * rbT * B.invInertia;
    }
  }
  // positional correction (Baumgarte-style split by inverse mass)
  const totalInv = A.invMass + B.invMass;
  if (totalInv > 0 && depth > 0.001) {
    const corr = Math.min(depth, 0.5) * 0.85;
    A.x -= nx * corr * (A.invMass / totalInv); A.z -= nz * corr * (A.invMass / totalInv);
    B.x += nx * corr * (B.invMass / totalInv); B.z += nz * corr * (B.invMass / totalInv);
  }
  return jn;
}

export const STATIC_BODY = { x: 0, z: 0, vx: 0, vz: 0, angVel: 0, invMass: 0, invInertia: 0 };
