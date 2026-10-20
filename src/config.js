// Tunables and the color palette. Colors are sRGB hex; three.js converts to linear.
export const CONFIG = {
  seed: 7,
  city: {
    n: 8,            // intersections per axis
    block: 64,       // buildable block edge (sidewalk to sidewalk)
    road: 12,        // road width, curb to curb
    sidewalk: 4.5,   // sidewalk width (part of the block footprint)
    lane: 3.5,       // driving lane width
    curb: 0.14,      // curb height
    shoulder: 36,    // grass beyond the ring road before the invisible wall
  },
  physics: { step: 1 / 120, maxSubSteps: 8, gravity: 22 },
  traffic: { target: 64, spawnRadius: 230, despawnRadius: 300, speed: 11.5 },
  parked: { density: 0.2, fill: 0.55, cullDistance: 300 },
  sun: { azimuthDeg: 236, elevationDeg: 24, color: 0xffd9a6, intensity: 3.4 },
  sky: { zenith: 0x2e6fd9, mid: 0x7fb6ff, horizon: 0xffd3a4, sunGlow: 0xffe9b8 },
  hemi: { sky: 0xa6c8ff, ground: 0xc89a6a, intensity: 1.15 },
  fog: { color: 0xffd3a4, near: 160, far: 640 },
  shadow: { mapSize: 4096, halfSize: 170, far: 700 },
  camera: { fov: 58, near: 0.4, far: 2200 },
};

export const PALETTE = {
  road: 0x7c788c,
  roadEdge: 0x6a6580,
  marking: 0xf4ead7,
  markingYellow: 0xf1c15a,
  crosswalk: 0xf6efe1,
  sidewalk: 0xc9bca3,
  sidewalkAlt: 0xbfb199,
  curb: 0xaa9d86,
  grass: 0x7fc24a,
  grassDark: 0x6aae3c,
  sand: 0xf0d79b,
  water: 0x39c3d8,
  waterDeep: 0x2aa8c4,
  dirt: 0xb98a5a,
  trunk: 0x8a5a36,
  trunkDark: 0x6e4428,
  foliage: [0x5fb24c, 0x74c25a, 0x4ea04a, 0x9bc94a, 0xf0a33c, 0xe6793a],
  lampPost: 0x3d3a45,
  lampHead: 0xfff1c4,
  bench: 0xb77a3f,
  hydrant: 0xe84a3c,
  planter: 0xc96a3f,
  // building bodies — saturated pastels that sing in warm light
  buildings: [
    0xf28c6a, 0xf5a65b, 0xf9c86d, 0x8fd0c9, 0x6fb4e3, 0xa993d9, 0xf08fb0, 0xffe0a8,
    0xe8705a, 0x7bc7b2, 0xfaf0dc, 0xd9b1e6, 0x9bd1f0, 0xf7b267, 0xef9c9c, 0xc5e0a5,
  ],
  trims: [0xfff6e6, 0x2d2a38, 0xffffff, 0x3c3850],
  roofs: [0xd1573f, 0x3b3747, 0x6c5a7a, 0x9e4f3b, 0x2f6a7a, 0xe6c77a],
  windowDark: 0x34476a,
  windowLit: 0xffe2a3,
  door: 0x2e2a3a,
  awning: [0xe84a3c, 0x2f8ad9, 0xf3c53d, 0x3cb371, 0xf06292],
  concrete: 0xe3d9c6,
  concreteDark: 0xcfc4ae,
  fountain: 0x8fd0c9,
  towerGlass: [0x6fb4e3, 0x8fd0c9, 0xa9d6f5],
  // cars
  carPaint: [0xe8402f, 0xf7b500, 0x2c8fe8, 0x27b06b, 0xff7a1a, 0xf2f2f2, 0x7a4bd6, 0xff5ea8, 0x1fc8d6, 0x5dd3ff, 0xd94f8c, 0x9ad04a],
  carGlass: 0x1e2a44,
  carTire: 0x1f1d26,
  carHub: 0xcfcfd6,
  carBumper: 0x3a3844,
  carChrome: 0xe9e9f0,
  headlight: 0xfff4c8,
  taillight: 0xff2d2d,
  taillightOff: 0x3a0e0e,
  wreck: 0x2a2730,
  wreckRust: 0x4a3a33,
  skin: 0xf2c7a2,
  shirt: 0xfff5e6,
  pants: 0x3458a8,
  shoes: 0x2b2735,
  cap: 0xff7a1a,
};
