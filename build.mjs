// Bundles TypeScript with esbuild and assembles dist/chrome and dist/firefox.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const watch = process.argv.includes('--watch');
const targets = ['chrome', 'firefox'];

/* ---- icons: GitHub-style "merged" glyph, white on purple, drawn as SVG and rasterized with resvg ---- */
function iconSvg(size) {
  // Heavier strokes at toolbar sizes; at 16px rings blur, so nodes become solid dots.
  const tiny = size <= 16, small = size <= 32;
  const w = tiny ? 14 : small ? 12 : 9, r = tiny ? 12 : small ? 11 : 10;
  const node = ([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}"${tiny ? ' fill="#fff"' : ''}/>`;
  const A = [44, 34], B = [44, 94], C = [88, 70]; // top, bottom, merged-into nodes on a 128 grid
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">
  <circle cx="64" cy="64" r="62" fill="#8250df"/>
  <g fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round">
    ${node(A)}${node(B)}${node(C)}
    <path d="M${A[0]} ${A[1] + r}V${B[1] - r}"/>
    <path d="M${A[0]} ${A[1] + r}C${A[0]} ${C[1] - 4} ${A[0] + 12} ${C[1]} ${C[0] - r} ${C[1]}"/>
  </g>
</svg>`;
}

const iconPng = (size) => new Resvg(iconSvg(size)).render().asPng();

function assemble(target) {
  const out = `dist/${target}`;
  mkdirSync(`${out}/icons`, { recursive: true });
  const manifest = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
  if (target === 'firefox') {
    manifest.browser_specific_settings = {
      gecko: { id: 'merge-guard@local', strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } },
    };
  }
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
  for (const f of ['ui/options.html', 'ui/options.css', 'ui/popup.html', 'ui/popup.css', 'ui/common.css', 'src/content.css']) {
    cpSync(f, `${out}/${f.split('/').pop()}`);
  }
  for (const s of [16, 32, 48, 128]) writeFileSync(`${out}/icons/${s}.png`, iconPng(s));
}

const entries = { content: 'src/content.ts', options: 'ui/options.ts', popup: 'ui/popup.ts' };
const opts = (target) => ({
  entryPoints: entries,
  outdir: `dist/${target}`,
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
});

rmSync('dist', { recursive: true, force: true });
for (const t of targets) assemble(t);
if (watch) {
  for (const t of targets) await (await context(opts(t))).watch();
  console.log('watching...');
} else {
  for (const t of targets) await build(opts(t));
  console.log('built dist/chrome and dist/firefox');
}
