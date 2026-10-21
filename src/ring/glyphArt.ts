/**
 * SVG artwork for the 24 glyphs. Each glyph is drawn in a 100x100 box
 * centred on (50, 50) with plain strokes so it can be tinted via CSS
 * `currentColor`. Shapes are deliberately simple and abstract.
 */

import type { GlyphId } from './glyphs';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ART: Record<GlyphId, string> = {
  cairn: '<circle cx="50" cy="74" r="16"/><circle cx="50" cy="45" r="11"/><circle cx="50" cy="25" r="7"/>',
  weir: '<path d="M18 35 q8 -8 16 0 t16 0 t16 0 t16 0"/><path d="M18 52 q8 -8 16 0 t16 0 t16 0 t16 0"/><path d="M18 69 q8 -8 16 0 t16 0 t16 0 t16 0"/>',
  spindle: '<line x1="50" y1="14" x2="50" y2="86"/><path d="M50 34 L62 50 L50 66 L38 50 Z"/>',
  lantern: '<path d="M50 18 L82 50 L50 82 L18 50 Z"/><circle cx="50" cy="50" r="5" class="fill"/>',
  crest: '<path d="M22 64 A28 28 0 0 1 78 64"/><line x1="16" y1="76" x2="84" y2="76"/>',
  thorn: '<path d="M50 18 L80 76 L20 76 Z"/><line x1="50" y1="8" x2="50" y2="90"/>',
  hollow: '<circle cx="50" cy="50" r="30"/><circle cx="62" cy="40" r="8"/>',
  tide: '<path d="M60 18 A32 32 0 1 0 60 82"/><path d="M72 28 A22 22 0 1 0 72 72"/>',
  loom: '<line x1="38" y1="16" x2="38" y2="84"/><line x1="62" y1="16" x2="62" y2="84"/><line x1="16" y1="38" x2="84" y2="38"/><line x1="16" y1="62" x2="84" y2="62"/>',
  keel: '<path d="M22 30 L50 80 L78 30"/><line x1="16" y1="24" x2="84" y2="24"/>',
  gyre: '<path d="M50 48 m0 -5 a5 5 0 0 1 5 5 a10 10 0 0 1 -10 10 a15 15 0 0 1 -15 -15 a20 20 0 0 1 20 -20 a25 25 0 0 1 25 25 a30 30 0 0 1 -30 30"/>',
  fork: '<line x1="50" y1="86" x2="50" y2="50"/><line x1="50" y1="50" x2="24" y2="18"/><line x1="50" y1="50" x2="76" y2="18"/>',
  mantle: '<path d="M24 84 L24 44 A26 26 0 0 1 76 44 L76 84"/><circle cx="50" cy="56" r="6" class="fill"/>',
  shard: '<path d="M36 14 L78 38 L62 86 L22 60 Z"/><line x1="36" y1="14" x2="62" y2="86"/>',
  bloom: '<circle cx="50" cy="50" r="9"/><circle cx="50" cy="26" r="11"/><circle cx="74" cy="50" r="11"/><circle cx="50" cy="74" r="11"/><circle cx="26" cy="50" r="11"/>',
  tether: '<circle cx="26" cy="68" r="11"/><circle cx="74" cy="32" r="11"/><line x1="34" y1="62" x2="66" y2="38"/>',
  beacon: '<circle cx="50" cy="50" r="14"/><line x1="50" y1="10" x2="50" y2="26"/><line x1="50" y1="74" x2="50" y2="90"/><line x1="10" y1="50" x2="26" y2="50"/><line x1="74" y1="50" x2="90" y2="50"/>',
  ridge: '<path d="M12 74 L32 36 L46 58 L62 26 L88 74"/>',
  span: '<path d="M18 58 A32 26 0 0 1 82 58"/><line x1="18" y1="58" x2="18" y2="84"/><line x1="82" y1="58" x2="82" y2="84"/><line x1="10" y1="58" x2="90" y2="58"/>',
  seed: '<path d="M50 14 C74 40 74 70 50 86 C26 70 26 40 50 14 Z"/><line x1="50" y1="36" x2="50" y2="72"/>',
  hearth: '<path d="M24 82 L24 46 L50 20 L76 46 L76 82 Z"/><line x1="24" y1="82" x2="76" y2="82"/><path d="M42 82 L42 62 L58 62 L58 82"/>',
  knot: '<circle cx="38" cy="50" r="22"/><circle cx="62" cy="50" r="22"/>',
  step: '<path d="M16 82 L16 64 L38 64 L38 44 L60 44 L60 24 L84 24"/>',
  vane: '<line x1="30" y1="88" x2="30" y2="14"/><path d="M30 16 L78 30 L30 46"/><line x1="18" y1="88" x2="42" y2="88"/>',
};

export function glyphMarkup(id: GlyphId): string {
  return ART[id];
}

/** Build a standalone <svg> element for a glyph. */
export function glyphSvg(id: GlyphId, className = 'glyph'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${ART[id]}</g>`;
  return svg;
}
