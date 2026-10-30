// Bundles TypeScript with esbuild and assembles dist/chrome and dist/firefox.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const watch = process.argv.includes('--watch');
const targets = ['chrome', 'firefox'];

/* ---- icons: green disc with a white tick, rendered with 4x4 supersampling ---- */
function iconPng(size) {
  const px = Buffer.alloc(size * size * 4);
  const seg = (x, y, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
  };
  const S = 4;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let disc = 0, tick = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (pxl + (sx + 0.5) / S) / size, y = (py + (sy + 0.5) / S) / size;
          if (Math.hypot(x - 0.5, y - 0.5) <= 0.48) {
            disc++;
            const d = Math.min(seg(x, y, 0.28, 0.52, 0.44, 0.67), seg(x, y, 0.44, 0.67, 0.73, 0.35));
            if (d <= 0.055) tick++;
          }
        }
      }
      const n = S * S, a = disc / n, w = disc ? tick / disc : 0;
      const o = (py * size + pxl) * 4;
      px[o] = Math.round(26 * (1 - w) + 255 * w);
      px[o + 1] = Math.round(127 * (1 - w) + 255 * w);
      px[o + 2] = Math.round(55 * (1 - w) + 255 * w);
      px[o + 3] = Math.round(a * 255);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

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
