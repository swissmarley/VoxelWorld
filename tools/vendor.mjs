// Bundles the three.js module build into a single minified ES module under vendor/,
// so the game runs from any static file server with no install or build step.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'node_modules/three/package.json'), 'utf8'));
mkdirSync(join(root, 'vendor'), { recursive: true });

await build({
  entryPoints: [join(root, 'node_modules/three/build/three.module.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  legalComments: 'none',
  outfile: join(root, 'vendor/three.module.js'),
  banner: { js: `/* three.js r${pkg.version} — MIT License — https://threejs.org — bundled by tools/vendor.mjs */` },
});
writeFileSync(join(root, 'vendor/THREE-VERSION.txt'), `three ${pkg.version}\n`);
console.log(`vendored three ${pkg.version} -> vendor/three.module.js`);
