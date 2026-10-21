/**
 * SVG ring: a fixed outer frame with chevrons and a top keystone, a rotating
 * inner band carrying the 24 glyphs, and the veil at the centre.
 * `render(frame)` maps a RingFrame (from ringTimeline) onto cached elements.
 */

import { type GlyphId, familyOf } from './glyphs';
import { FAMILY_COLOR } from './families';
import { glyphMarkup } from './glyphArt';
import { type ChevronLight, GLYPH_STEP_DEG, type Mark, RING_ORDER, type RingFrame } from './ringTimeline';

const NS = 'http://www.w3.org/2000/svg';

const LIGHT_COLOR: Record<ChevronLight, string> = {
  dark: '#1b222b',
  armed: '#c9d3dd',
  energy: '#4da3ff',
  locked: '#4fc38a',
  drifting: '#e0b64b',
  absent: '#6b7584',
};

/** The ring's energy colour: rim lights, keystone and the veil. */
const ENERGY = '#4da3ff';

const KEY_COLOR: Record<Mark, string> = { locked: '#4fc38a', drifting: '#e0b64b', absent: '#6b7584' };

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

function glyphGroup(id: GlyphId, size: number, parent: Element, attrs: Record<string, string | number> = {}): SVGGElement {
  const s = size / 100;
  const g = el('g', { ...attrs }, parent);
  const inner = el('g', {
    transform: `translate(${-size / 2} ${-size / 2}) scale(${s})`,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 7,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }, g);
  inner.innerHTML = glyphMarkup(id).replace(/class="fill"/g, 'fill="currentColor"');
  return g;
}

let uid = 0;

export class RingView {
  readonly el: HTMLDivElement;
  /**
   * An empty layer over the event surface and under the chevrons, for things
   * fitted across the opening (radius 107), such as Shutter Duty's iris.
   */
  readonly apertureLayer: SVGGElement;
  private readonly svg: SVGSVGElement;
  private readonly rotor: SVGGElement;
  private readonly rimOuter: SVGCircleElement;
  private readonly rimInner: SVGCircleElement;
  private readonly keystone: SVGGElement;
  private readonly keystoneLight: SVGPathElement;
  private readonly targetGlow: SVGPathElement;
  private readonly veilGroup: SVGGElement;
  private readonly veilDisc: SVGCircleElement;
  private readonly veilClip: SVGCircleElement;
  private readonly veilRings: SVGCircleElement[];
  private readonly flash: SVGCircleElement;
  private readonly burstFlash: SVGCircleElement;
  private readonly shockRings: SVGCircleElement[];
  private readonly turbulence: SVGFETurbulenceElement;
  private readonly chevronLayer: SVGGElement;
  private chevrons: { light: SVGPathElement; glyphHolder: SVGGElement; glyph: GlyphId | null }[] = [];
  private readonly ids: Record<string, string>;
  reducedMotion = false;

  constructor(slotCount: number) {
    const n = ++uid;
    this.ids = {
      frame: `fp-frame-${n}`,
      band: `fp-band-${n}`,
      glow: `fp-glow-${n}`,
      veil: `fp-veil-${n}`,
      veilFx: `fp-veilfx-${n}`,
      veilClip: `fp-veilclip-${n}`,
      deep: `fp-deep-${n}`,
    };
    this.el = document.createElement('div');
    this.el.className = 'ring-wrap';
    this.svg = el('svg', { viewBox: '-210 -210 420 420', class: 'ring', role: 'img', 'aria-label': 'Ring' });
    this.el.appendChild(this.svg);

    const defs = el('defs', {}, this.svg);
    defs.innerHTML = `
      <radialGradient id="${this.ids.frame}" cx="0" cy="0" r="200" gradientUnits="userSpaceOnUse">
        <stop offset="0.72" stop-color="#20262e"/><stop offset="0.82" stop-color="#3b434d"/>
        <stop offset="0.9" stop-color="#2a3038"/><stop offset="1" stop-color="#14181d"/>
      </radialGradient>
      <radialGradient id="${this.ids.band}" cx="0" cy="0" r="150" gradientUnits="userSpaceOnUse">
        <stop offset="0.7" stop-color="#2a241d"/><stop offset="0.85" stop-color="#4a3f31"/><stop offset="1" stop-color="#231e18"/>
      </radialGradient>
      <radialGradient id="${this.ids.deep}" cx="0" cy="0" r="108" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#05070a"/><stop offset="0.85" stop-color="#0b1016"/><stop offset="1" stop-color="#151b22"/>
      </radialGradient>
      <radialGradient id="${this.ids.veil}" cx="0" cy="0" r="108" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#f2fbff"/><stop offset="0.3" stop-color="#a8dcff"/>
        <stop offset="0.62" stop-color="#3d8eff"/><stop offset="0.88" stop-color="#1b3c9c"/><stop offset="1" stop-color="#0a1440"/>
      </radialGradient>
      <filter id="${this.ids.glow}" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <clipPath id="${this.ids.veilClip}"><circle r="106"/></clipPath>
      <filter id="${this.ids.veilFx}" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="18" xChannelSelector="R" yChannelSelector="G"/>
      </filter>`;
    this.turbulence = defs.querySelector('feTurbulence') as SVGFETurbulenceElement;

    // Backplate and outer frame.
    el('circle', { r: 206, fill: '#090c10', stroke: '#1d242d', 'stroke-width': 2 }, this.svg);
    el('path', {
      d: 'M0 -197 A197 197 0 1 1 0 197 A197 197 0 1 1 0 -197 Z M0 -151 A151 151 0 1 0 0 151 A151 151 0 1 0 0 -151 Z',
      fill: `url(#${this.ids.frame})`,
      'fill-rule': 'evenodd',
      stroke: '#0b0e12',
      'stroke-width': 2,
    }, this.svg);
    const notches = el('g', { stroke: '#151a20', 'stroke-width': 2 }, this.svg);
    for (let i = 0; i < 48; i++) {
      el('line', { x1: 0, y1: -188, x2: 0, y2: -195, transform: `rotate(${i * 7.5})` }, notches);
    }
    this.rimOuter = el('circle', { r: 192, fill: 'none', stroke: ENERGY, 'stroke-width': 2, opacity: 0, filter: `url(#${this.ids.glow})` }, this.svg);
    this.rimInner = el('circle', { r: 153, fill: 'none', stroke: ENERGY, 'stroke-width': 1.5, opacity: 0, filter: `url(#${this.ids.glow})` }, this.svg);

    // Rotating glyph band.
    this.rotor = el('g', {}, this.svg);
    el('path', {
      d: 'M0 -149 A149 149 0 1 1 0 149 A149 149 0 1 1 0 -149 Z M0 -108 A108 108 0 1 0 0 108 A108 108 0 1 0 0 -108 Z',
      fill: `url(#${this.ids.band})`,
      'fill-rule': 'evenodd',
      stroke: '#120f0b',
      'stroke-width': 2,
    }, this.rotor);
    // Each family is one tinted arc of the band, its glyphs in the family colour.
    const half = Math.PI / 24; // half of one 15-degree glyph segment
    const wedge = `M${-149 * Math.sin(half)} ${-149 * Math.cos(half)} A149 149 0 0 1 ${149 * Math.sin(half)} ${-149 * Math.cos(half)} L${108 * Math.sin(half)} ${-108 * Math.cos(half)} A108 108 0 0 0 ${-108 * Math.sin(half)} ${-108 * Math.cos(half)} Z`;
    const tints = el('g', {}, this.rotor);
    const seps = el('g', { stroke: '#17130e', 'stroke-width': 2 }, this.rotor);
    RING_ORDER.forEach((id, k) => {
      const color = FAMILY_COLOR[familyOf(id)];
      el('path', { d: wedge, fill: color, 'fill-opacity': 0.13, transform: `rotate(${k * GLYPH_STEP_DEG})` }, tints);
      el('line', { x1: 0, y1: -110, x2: 0, y2: -147, transform: `rotate(${k * GLYPH_STEP_DEG + GLYPH_STEP_DEG / 2})` }, seps);
      const holder = el('g', { transform: `rotate(${k * GLYPH_STEP_DEG}) translate(0 -128)`, color, class: 'ring-glyph' }, this.rotor);
      glyphGroup(id, 28, holder);
    });

    // Highlight of the band segment under the keystone (fixed, not rotating).
    // Exactly one glyph width (15 degrees, so half-angle 7.5).
    const sn = Math.sin(Math.PI / 24);
    const cs = Math.cos(Math.PI / 24);
    this.targetGlow = el('path', {
      d: `M${-149 * sn} ${-149 * cs} A149 149 0 0 1 ${149 * sn} ${-149 * cs} L${108 * sn} ${-108 * cs} A108 108 0 0 0 ${-108 * sn} ${-108 * cs} Z`,
      fill: ENERGY,
      opacity: 0,
      filter: `url(#${this.ids.glow})`,
    }, this.svg);

    // Veil (centre).
    el('circle', { r: 107, fill: `url(#${this.ids.deep})` }, this.svg);
    // The opening grows as a clean circle (the clip); the surface inside is
    // oversized so its turbulent edge is always cut away.
    this.veilGroup = el('g', { opacity: 0, 'clip-path': `url(#${this.ids.veilClip})` }, this.svg);
    this.veilClip = defs.querySelector('clipPath circle') as SVGCircleElement;
    this.veilDisc = el('circle', { r: 135, fill: `url(#${this.ids.veil})`, filter: `url(#${this.ids.veilFx})` }, this.veilGroup);
    this.veilRings = [0, 1, 2].map(() => el('circle', { r: 10, fill: 'none', stroke: '#d9f0ff', 'stroke-width': 2, opacity: 0 }, this.veilGroup));
    this.flash = el('circle', { r: 108, fill: '#eef8ff', opacity: 0 }, this.svg);
    this.apertureLayer = el('g', { class: 'aperture-layer' }, this.svg);

    // Chevrons and keystone.
    this.chevronLayer = el('g', {}, this.svg);
    this.keystone = el('g', {}, this.svg);
    el('path', { d: 'M-26 -209 L26 -209 L18 -170 L0 -154 L-18 -170 Z', fill: '#2f363f', stroke: '#0b0e12', 'stroke-width': 2 }, this.keystone);
    this.keystoneLight = el('path', { d: 'M-14 -200 L14 -200 L9 -175 L0 -166 L-9 -175 Z', fill: LIGHT_COLOR.dark, filter: `url(#${this.ids.glow})` }, this.keystone);

    // Burst effects sit above everything: a whole-ring flash and a shockwave
    // that sweeps out past the frame.
    this.burstFlash = el('circle', { r: 206, fill: '#f2f9ff', opacity: 0, 'pointer-events': 'none' }, this.svg);
    this.shockRings = [0, 1].map(() => el('circle', { r: 110, fill: 'none', stroke: '#cfe9ff', 'stroke-width': 10, opacity: 0, 'pointer-events': 'none' }, this.svg));

    this.setSlotCount(slotCount);
    this.render(idleFrame(slotCount, 0), 0);
  }

  setSlotCount(n: number) {
    this.chevronLayer.replaceChildren();
    this.chevrons = [];
    for (let i = 0; i < n; i++) {
      const a = (360 * (i + 1)) / (n + 1);
      const g = el('g', { transform: `rotate(${a}) translate(0 -174)` }, this.chevronLayer);
      el('path', { d: 'M-24 -24 L24 -24 L18 10 L0 24 L-18 10 Z', fill: '#2a3038', stroke: '#0b0e12', 'stroke-width': 2 }, g);
      const light = el('path', { d: 'M-16 -17 L16 -17 L12 6 L0 16 L-12 6 Z', fill: LIGHT_COLOR.dark, filter: `url(#${this.ids.glow})` }, g);
      const glyphHolder = el('g', { color: '#0b0e12', transform: 'translate(0 -3)' }, g);
      this.chevrons.push({ light, glyphHolder, glyph: null });
    }
  }

  render(f: RingFrame, timeMs: number) {
    this.rotor.setAttribute('transform', `rotate(${f.angle.toFixed(3)})`);

    this.rimOuter.setAttribute('opacity', (0.15 + 0.6 * f.rim).toFixed(3));
    this.rimInner.setAttribute('opacity', (0.1 + 0.4 * f.rim).toFixed(3));

    // Keystone travel and colour.
    this.keystone.setAttribute('transform', `translate(0 ${(f.keystone * 14).toFixed(2)})`);
    const keyColor = f.keystoneMark ? KEY_COLOR[f.keystoneMark] : f.rim > 0.05 ? ENERGY : LIGHT_COLOR.dark;
    this.keystoneLight.setAttribute('fill', keyColor);
    this.keystoneLight.setAttribute('opacity', (0.35 + 0.65 * Math.max(f.rim, f.keystone)).toFixed(3));
    this.targetGlow.setAttribute('fill', f.keystoneMark ? KEY_COLOR[f.keystoneMark] : ENERGY);
    this.targetGlow.setAttribute('opacity', (f.keystoneMark ? 0.45 * f.keystone : f.phase === 'dialing' ? 0.12 : 0).toFixed(3));

    f.chevrons.forEach((c, i) => {
      const view = this.chevrons[i];
      if (!view) return;
      view.light.setAttribute('fill', LIGHT_COLOR[c.light]);
      view.light.setAttribute('opacity', (c.light === 'dark' ? 1 : 0.25 + 0.75 * c.glow).toFixed(3));
      if (view.glyph !== c.glyph) {
        view.glyphHolder.replaceChildren();
        if (c.glyph) glyphGroup(c.glyph, 18, view.glyphHolder);
        view.glyph = c.glyph;
      }
    });

    // Veil.
    const v = f.veil;
    this.veilGroup.setAttribute('opacity', Math.min(1, v * 1.4).toFixed(3));
    this.veilClip.setAttribute('r', (106 * (0.08 + 0.92 * v)).toFixed(2));
    if (v > 0) {
      // Slow swirl and a gently breathing surface.
      this.veilDisc.setAttribute('transform', `rotate(${((timeMs / 40) % 360).toFixed(2)})`);
      const freq = 0.016 + 0.004 * Math.sin(timeMs / 1100);
      this.turbulence.setAttribute('baseFrequency', `${freq.toFixed(4)} ${(freq * 1.25).toFixed(4)}`);
    }
    this.veilRings.forEach((ring, i) => {
      const p = (timeMs / 1600 + i / 3) % 1;
      ring.setAttribute('r', (8 + 98 * p).toFixed(1));
      ring.setAttribute('opacity', (v * 0.5 * (1 - p)).toFixed(3));
    });
    this.flash.setAttribute('opacity', (v > 0 ? Math.max(0, 1 - v * 2.2) : 0).toFixed(3));

    // Camera shake: deterministic wobble scaled by impact strength.
    // Burst flash and shockwave (the flash is softened with reduced motion).
    this.burstFlash.setAttribute('opacity', (f.flash * (this.reducedMotion ? 0.35 : 0.85)).toFixed(3));
    this.shockRings.forEach((ring, i) => {
      const p = this.reducedMotion ? 0 : Math.max(0, f.shock - i * 0.18) / (1 - i * 0.18);
      const live = f.shock > 0 && p > 0 && p < 1;
      const e = 1 - Math.pow(1 - p, 3);
      ring.setAttribute('r', (110 + 250 * e).toFixed(1));
      ring.setAttribute('stroke-width', (12 * (1 - p) + 1).toFixed(2));
      ring.setAttribute('opacity', live ? ((1 - p) * (i === 0 ? 0.9 : 0.5)).toFixed(3) : '0');
    });

    const s = this.reducedMotion ? 0 : f.shake;
    const x = s * 5 * Math.sin(timeMs * 0.093);
    const y = s * 4 * Math.cos(timeMs * 0.117);
    this.el.style.transform = s > 0.001 ? `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)` : '';
  }
}

/** Resting frame: lights off, ring at `angle`. */
export function idleFrame(slotCount: number, angle: number): RingFrame {
  return {
    angle,
    speed: 0,
    keystone: 0,
    keystoneMark: null,
    activeSlot: null,
    chevrons: Array.from({ length: slotCount }, () => ({ light: 'dark' as ChevronLight, glow: 0, glyph: null })),
    rim: 0,
    shake: 0,
    veil: 0,
    flash: 0,
    shock: 0,
    phase: 'done',
  };
}
