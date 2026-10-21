// Inlines a Vite build into one self-contained HTML file so it can be shared
// as a single page. Run after `vite build`.
//
//   node scripts/build-artifact.mjs [distDir] [page.html] [out.html]
//
// Defaults: dist/index.html -> dist/shutter-duty.html.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dist = 'dist', page = 'index.html', outName = 'shutter-duty.html'] = process.argv.slice(2);
const index = readFileSync(join(dist, page), 'utf8');
const title = index.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Shutter Duty';
// Web-font links (Google Fonts) are kept; everything else is inlined.
const fontLinks = [...index.matchAll(/<link[^>]+fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]).join('\n');

const jsPath = index.match(/<script[^>]*src="(?:\.\.\/)*\/?([^"]+\.js)"/)?.[1];
const cssPath = index.match(/<link[^>]*href="(?:\.\.\/)*\/?([^"]+\.css)"/)?.[1];
if (!jsPath || !cssPath) throw new Error(`Could not find the built JS and CSS in ${join(dist, page)}`);

const js = readFileSync(join(dist, jsPath), 'utf8');
const css = readFileSync(join(dist, cssPath), 'utf8');
// A literal closing script tag inside the bundle would end the inline script early.
if (/<\/script/i.test(js)) throw new Error('Bundle contains "</script"; cannot inline safely');
if (/<\/style/i.test(css)) throw new Error('Stylesheet contains "</style"; cannot inline safely');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
${fontLinks}
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script type="module">${js}</script>
</body>
</html>
`;

const out = join(dist, outName);
writeFileSync(out, html);
console.log(`Wrote ${out} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB)`);
