// Renderer, golden-hour lighting, gradient sky with sun, low-poly clouds and fog.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { GeomBuilder } from './geometry.js';
import { DEG } from '../util/math.js';

export function sunDirection() {
  const az = CONFIG.sun.azimuthDeg * DEG, el = CONFIG.sun.elevationDeg * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

export function createRenderer(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio ?? 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(CONFIG.sky.horizon, 1);
  return renderer;
}

export function makeWorldMaterial() {
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(CONFIG.sky.horizon, CONFIG.fog.near, CONFIG.fog.far);

  const sunDir = sunDirection();
  const sun = new THREE.DirectionalLight(CONFIG.sun.color, CONFIG.sun.intensity);
  sun.castShadow = true;
  const s = CONFIG.shadow;
  sun.shadow.mapSize.set(s.mapSize, s.mapSize);
  sun.shadow.camera.left = -s.halfSize; sun.shadow.camera.right = s.halfSize;
  sun.shadow.camera.top = s.halfSize; sun.shadow.camera.bottom = -s.halfSize;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = s.far;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.25;
  sun.shadow.radius = 2;
  sun.target = new THREE.Object3D();
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(CONFIG.hemi.sky, CONFIG.hemi.ground, CONFIG.hemi.intensity);
  scene.add(hemi);
  // faint fill from the opposite side so shadowed facades keep some color
  const fill = new THREE.DirectionalLight(0xa9c8ff, 0.35);
  fill.position.set(-sunDir.x * 100, 60, -sunDir.z * 100);
  scene.add(fill);

  // ---- sky dome ----
  const toLin = (hex) => new THREE.Color(hex);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: toLin(CONFIG.sky.zenith) },
      mid: { value: toLin(CONFIG.sky.mid) },
      horizon: { value: toLin(CONFIG.sky.horizon) },
      sunGlow: { value: toLin(CONFIG.sky.sunGlow) },
      sunDir: { value: sunDir.clone() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = normalize(wp.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 zenith, mid, horizon, sunGlow, sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, mid, smoothstep(0.02, 0.22, h));
        col = mix(col, zenith, smoothstep(0.16, 0.7, h));
        if (h < 0.0) col = mix(horizon, horizon * 0.92, smoothstep(0.0, -0.3, h));
        float s = max(dot(d, sunDir), 0.0);
        col += sunGlow * (pow(s, 6.0) * 0.28 + pow(s, 40.0) * 0.55);
        col = mix(col, vec3(1.0, 0.985, 0.94) * 1.4, smoothstep(0.9975, 0.9988, s));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
  sky.name = 'sky';
  sky.frustumCulled = false;
  scene.add(sky);

  // ---- clouds ----
  const clouds = buildClouds();
  scene.add(clouds);

  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 16 / 9, CONFIG.camera.near, CONFIG.camera.far);
  camera.position.set(0, 40, 120);

  const _focus = new THREE.Vector3();
  return {
    scene, sun, hemi, sky, clouds, camera, sunDir,
    /** Re-aim the shadow frustum around a world point. */
    updateSun(fx, fz) {
      _focus.set(fx, 0, fz);
      sun.target.position.copy(_focus);
      sun.position.copy(_focus).addScaledVector(sunDir, 420);
      sun.target.updateMatrixWorld();
    },
    update(dt, t) {
      clouds.position.x = (t * 1.2) % 400;
      // sky dome rides with the camera so it can never be clipped by the far plane
      sky.position.copy(camera.position);
    },
  };
}

function buildClouds() {
  const gb = new GeomBuilder();
  // deterministic cloud field (independent from the city seed so the sky is always the same)
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const rng = { next: rnd };
  for (let i = 0; i < 26; i++) {
    const cx = (rnd() - 0.5) * 2400, cz = (rnd() - 0.5) * 2400 - 200, cy = 150 + rnd() * 110;
    const puffs = 3 + Math.floor(rnd() * 4);
    const base = 18 + rnd() * 26;
    const tint = rnd() < 0.5 ? 0xfff8ee : 0xffeedd;
    for (let p = 0; p < puffs; p++) {
      const px = cx + (rnd() - 0.5) * base * 2.2, pz = cz + (rnd() - 0.5) * base * 0.9;
      const r = base * (0.45 + rnd() * 0.5);
      gb.icosphere(px, cy + (rnd() - 0.3) * 8, pz, r, 1, tint, { scale: [1.3, 0.55, 1], jitter: 0.06, rng });
    }
  }
  const mesh = new THREE.Mesh(gb.build(), new THREE.MeshLambertMaterial({ vertexColors: true, fog: false, emissive: 0x3a2a22 }));
  mesh.name = 'clouds';
  mesh.frustumCulled = false;
  return mesh;
}
