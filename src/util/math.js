export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inverseLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp01(inverseLerp(a, b, v)));
export const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/** Frame-rate independent exponential approach of a toward b. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const moveToward = (v, target, maxDelta) => (Math.abs(target - v) <= maxDelta ? target : v + Math.sign(target - v) * maxDelta);

/** wrap an angle to [-PI, PI] */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export const angleDiff = (a, b) => wrapAngle(b - a);
export const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));

export const len2 = (x, z) => Math.hypot(x, z);
export const dist2 = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

/** cubic bezier point for 2D (x,z) control points */
export function bezier2(p0, p1, p2, p3, t, out = { x: 0, z: 0 }) {
  const u = 1 - t, uu = u * u, tt = t * t;
  const a = uu * u, b = 3 * uu * t, c = 3 * u * tt, d = tt * t;
  out.x = a * p0.x + b * p1.x + c * p2.x + d * p3.x;
  out.z = a * p0.z + b * p1.z + c * p2.z + d * p3.z;
  return out;
}

export function easeOutCubic(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
export function easeInOutSine(t) { t = clamp01(t); return -(Math.cos(Math.PI * t) - 1) / 2; }
