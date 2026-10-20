// Bundles the whole game into one self-contained HTML file (dist/hotwire.html): three.js,
// every module, the stylesheet and the HUD markup inlined. Double-click it to play offline.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist'), { recursive: true });
const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  write: false,
  legalComments: 'none',
  alias: { three: join(root, 'vendor/three.module.js') },
});
const js = result.outputFiles[0].text;
const css = readFileSync(join(root, 'src/ui/style.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="\.\/src\/ui\/style\.css" \/>/, `<style>\n${css}\n</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n/, '');
html = html.replace(/<script type="module" src="\.\/src\/main\.js"><\/script>/, () => `<script type="module">\n${js.replace(/<\/script/g, '<\\/script')}\n</script>`);
const out = join(root, 'dist/hotwire.html');
writeFileSync(out, html);
console.log(`built ${out} (${(html.length / 1024).toFixed(0)} KB)`);

// Artifact variant: the hosting page supplies the document skeleton, so ship only the inner content.
let frag = html
  .replace(/^<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, '')
  .replace(/<meta charset="utf-8" \/>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*\/>\s*/i, '')
  .replace(/<meta name="theme-color"[^>]*\/>\s*/i, '')
  .replace(/<link rel="icon"[^>]*\/>\s*/i, '')
  .replace(/<\/head>\s*<body>\s*/i, '')
  .replace(/\s*<\/body>\s*<\/html>\s*$/i, '\n')
  .replace('<title>HOTWIRE — sunset joyride sandbox</title>', '<title>HOTWIRE</title>')
  .replace(':root {\n  --accent: #ff8a3d;', ':root {\n  color-scheme: dark;\n  --accent: #ff8a3d;');
const outA = join(root, 'dist/hotwire-artifact.html');
writeFileSync(outA, frag);
console.log(`built ${outA} (${(frag.length / 1024).toFixed(0)} KB)`);
