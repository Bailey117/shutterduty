/**
 * The iris: twelve curved bronze blades that spiral shut across the ring's
 * opening. When a wormhole is held behind it, light leaks along the blade
 * seams, each in one of the glyph families' colours (two blades per family).
 *
 * Each blade pivots on a pin at the rim and swings out past the edge to open,
 * like a camera aperture. It is drawn into the ring's aperture layer, so it
 * shares the ring's coordinates (opening radius 107).
 */

import { familyOf } from '../ring/glyphs';
import { FAMILY_COLOR } from '../ring/families';
import { RING_ORDER } from '../ring/ringTimeline';

const NS = 'http://www.w3.org/2000/svg';
const BLADES = 12;
const R = 107;
/** How far each blade swings about its pin, and how far it slides back into the frame, to clear the opening. */
const OPEN_DEG = 62;
const OPEN_SLIDE = R * 1.05;

let uid = 0;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (r: number, deg: number) => [r * Math.sin(rad(deg)), -r * Math.cos(rad(deg))] as const;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export class Iris {
  private readonly blades: SVGGElement[] = [];
  private readonly seams: SVGPathElement[] = [];
  private readonly root: SVGGElement;
  private readonly pivot: readonly [number, number];
  private amount = 0; // 0 closed .. 1 open
  private anim = 0;

  constructor(layer: SVGGElement) {
    const id = `sd-iris-${++uid}`;
    this.root = el('g', { class: 'iris' }, layer);
    const defs = el('defs', {}, this.root);
    defs.innerHTML = `
      <clipPath id="${id}-clip"><circle r="${R}"/></clipPath>
      <linearGradient id="${id}-metal" x1="0" y1="-1" x2="0.3" y2="0" gradientUnits="objectBoundingBox">
        <stop offset="0" stop-color="#5b4c39"/><stop offset="0.45" stop-color="#3b3227"/><stop offset="1" stop-color="#1f1a14"/>
      </linearGradient>`;
    const clipped = el('g', { 'clip-path': `url(#${id}-clip)` }, this.root);

    // One blade in closed position. Blades are the spaces between identical
    // spiral curves, so closed they tile the opening exactly, like a pinwheel,
    // with no overlaps to stack in the wrong order. The pin sits on the rim at
    // the blade's leading corner.
    const step = 360 / BLADES;
    const outerR = R + 18;
    const bend = 40;
    const curveFrom = (deg: number) => {
      const [x0, y0] = polar(outerR, deg);
      const [qx, qy] = polar(R * 0.62, deg + bend);
      return { x0, y0, qx, qy };
    };
    const a = curveFrom(0);
    const b = curveFrom(step);
    const f = (n: number) => n.toFixed(2);
    const shape = `M0 0 Q${f(a.qx)} ${f(a.qy)} ${f(a.x0)} ${f(a.y0)} A${outerR} ${outerR} 0 0 1 ${f(b.x0)} ${f(b.y0)} Q${f(b.qx)} ${f(b.qy)} 0 0 Z`;
    const seam = `M${f(b.x0)} ${f(b.y0)} Q${f(b.qx)} ${f(b.qy)} 0 0`;
    this.pivot = polar(R, 0);

    for (let i = 0; i < BLADES; i++) {
      const glyph = RING_ORDER[i * 2]!;
      const color = FAMILY_COLOR[familyOf(glyph)];
      const outer = el('g', { transform: `rotate(${i * step})` }, clipped);
      const blade = el('g', {}, outer);
      el('path', { d: shape, fill: `url(#${id}-metal)`, stroke: '#0f0c09', 'stroke-width': 2, 'stroke-linejoin': 'round' }, blade);
      // A raised rib along the trailing curve, and the leak of light along it.
      el('path', { d: seam, fill: 'none', stroke: '#7a6649', 'stroke-width': 1.5, opacity: 0.8 }, blade);
      this.seams.push(el('path', { d: seam, fill: 'none', stroke: color, 'stroke-width': 4, opacity: 0, class: 'iris-seam', style: `color:${color}` }, blade));
      // The pin it turns on.
      el('circle', { cx: f(this.pivot[0]), cy: f(this.pivot[1]), r: 3.2, fill: '#8d7a5c', stroke: '#0f0c09', 'stroke-width': 1 }, blade);
      this.blades.push(blade);
    }
    // A dark lip round the opening hides the blades' roots.
    el('circle', { r: R, fill: 'none', stroke: '#0b0e12', 'stroke-width': 4 }, this.root);
    this.apply();
  }

  get isOpen(): boolean {
    return this.amount > 0.5;
  }

  private apply() {
    const deg = (OPEN_DEG * this.amount).toFixed(2);
    const slide = (OPEN_SLIDE * Math.max(0, this.amount - 0.15) / 0.85).toFixed(2);
    const [px, py] = this.pivot;
    for (const b of this.blades) b.setAttribute('transform', `translate(0 ${-slide}) rotate(${deg} ${px.toFixed(2)} ${py.toFixed(2)})`);
  }

  /** Swing the blades open or shut. Resolves when they stop. */
  set(open: boolean, ms = 650): Promise<void> {
    cancelAnimationFrame(this.anim);
    const from = this.amount;
    const to = open ? 1 : 0;
    if (ms <= 0 || from === to) {
      this.amount = to;
      this.apply();
      return Promise.resolve();
    }
    const t0 = performance.now();
    const dur = ms * Math.abs(to - from);
    return new Promise((resolve) => {
      const step = () => {
        const u = Math.min(1, (performance.now() - t0) / dur);
        this.amount = from + (to - from) * easeInOut(u);
        this.apply();
        if (u < 1) this.anim = requestAnimationFrame(step);
        else resolve();
      };
      this.anim = requestAnimationFrame(step);
    });
  }

  /** Light leaking along the seams (0 none .. 1 full), e.g. while a wormhole is held behind. */
  glow(level: number) {
    for (const s of this.seams) s.setAttribute('opacity', Math.min(1, level).toFixed(3));
  }
}
