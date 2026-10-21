/**
 * The gate: the ring (src/ring: view, dial timeline and sound, first built
 * for the Farpoint prototype) with an iris fitted across the opening.
 *
 * An incoming wormhole plays a quicker version of Farpoint's dial: the ring
 * turns to each glyph of the origin address, every chevron locks, and the
 * burst fires behind the closed iris. The event surface then stays open
 * (shimmering behind the iris, light leaking at the seams) until the call
 * is made and the wormhole collapses.
 */

import type { GlyphId } from '../ring/glyphs';
import { type DialTiming, type RingFrame, REDUCED_TIMING, buildDialPlan, burstTime, sampleRing } from '../ring/ringTimeline';
import { RingView, idleFrame } from '../ring/ringView';
import { RingSound } from '../ring/ringSound';
import { Iris } from './iris';
import { audioContext, soundOn } from './sound';

/** The ring's dial, sped up: an incoming lock is quicker than a dial-out. */
const INCOMING_TIMING: DialTiming = {
  powerUpMs: 250,
  rotateBaseMs: 140,
  rotatePerDegMs: 0.4,
  engageMs: 70,
  holdMs: 110,
  releaseMs: 60,
  finaleSuccessMs: 2600,
  finaleFailMs: 500,
};

const SLOTS = 6;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export class Gate {
  readonly el: HTMLDivElement;
  private readonly ring = new RingView(SLOTS);
  private readonly iris: Iris;
  private sound: RingSound | null = null;
  private angle = 0;
  private raf = 0;
  /** Last frame drawn, so a collapse can fade from wherever it is. */
  private last: RingFrame = idleFrame(SLOTS, 0);

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'gate';
    this.el.append(this.ring.el);
    this.iris = new Iris(this.ring.apertureLayer);
    this.ring.render(this.last, performance.now());
  }

  private ringSound(): RingSound | null {
    const ctx = audioContext();
    if (!ctx) return null;
    this.sound ??= new RingSound(ctx);
    this.sound.setEnabled(soundOn());
    return this.sound;
  }

  /**
   * A wormhole arrives from `origin`. `onBurst` fires when the surface forms
   * (the transmission comes through then); resolves when the lock sequence ends.
   */
  incoming(origin: readonly GlyphId[], onBurst: () => void): Promise<void> {
    this.stop();
    const reduced = prefersReducedMotion();
    this.ring.reducedMotion = reduced;
    const plan = buildDialPlan(origin, origin.map(() => 'locked'), this.angle, reduced ? REDUCED_TIMING : INCOMING_TIMING);
    const s = this.ringSound();
    const lead = 0.04;
    s?.scheduleDial(plan, s.ctx.currentTime + lead);
    const t0 = performance.now() + lead * 1000;
    const burstAt = burstTime(plan);
    let burst = false;
    return new Promise((resolve) => {
      let resolved = false;
      const tick = () => {
        const t = performance.now() - t0;
        const frame = sampleRing(plan, Math.min(t, plan.totalMs));
        this.draw(frame);
        if (!burst && t >= burstAt) {
          burst = true;
          onBurst();
        }
        // Light leaks round the iris once the surface is up.
        this.iris.glow(this.iris.isOpen ? 0 : Math.min(1, frame.veil * 1.2));
        if (t >= plan.totalMs && !resolved) {
          resolved = true;
          this.angle = plan.finalAngle;
          resolve();
        }
        // Keep the surface alive (it swirls with time) until collapse.
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  private draw(frame: RingFrame) {
    this.last = frame;
    this.ring.render(frame, performance.now());
  }

  private stop() {
    cancelAnimationFrame(this.raf);
  }

  openIris(): Promise<void> {
    this.iris.glow(0);
    return this.iris.set(true, prefersReducedMotion() ? 0 : 650);
  }

  async closeIris(): Promise<void> {
    await this.iris.set(false, prefersReducedMotion() ? 0 : 550);
    if (this.last.veil > 0) this.iris.glow(1);
  }

  /** The wormhole shuts down: surface fades, chevrons go dark. */
  collapse(ms = 600): Promise<void> {
    this.stop();
    const from = this.last;
    const t0 = performance.now();
    const dur = prefersReducedMotion() ? 1 : ms;
    return new Promise((resolve) => {
      const tick = () => {
        const u = Math.min(1, (performance.now() - t0) / dur);
        const k = 1 - u;
        const frame: RingFrame = {
          ...from,
          veil: from.veil * k,
          rim: from.rim * k,
          flash: 0,
          shock: 0,
          shake: 0,
          keystone: from.keystone * k,
          chevrons: from.chevrons.map((c) => (u >= 1 ? { light: 'dark', glow: 0, glyph: null } : { ...c, glow: c.glow * k })),
        };
        this.draw(frame);
        this.iris.glow(this.iris.isOpen ? 0 : frame.veil);
        if (u < 1) this.raf = requestAnimationFrame(tick);
        else {
          this.draw(idleFrame(SLOTS, this.angle));
          resolve();
        }
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  /** Feedback around the ring: a coloured halo, and a shake for bad news. */
  flash(kind: 'good' | 'bad') {
    this.el.classList.remove('flash-good', 'flash-bad', 'shake');
    void this.el.offsetWidth;
    this.el.classList.add(kind === 'good' ? 'flash-good' : 'flash-bad');
    if (kind === 'bad') this.el.classList.add('shake');
  }

  /** Someone hits the closed iris from the far side. */
  impact() {
    this.el.classList.remove('impact');
    void this.el.offsetWidth;
    this.el.classList.add('impact');
  }

  dispose() {
    this.stop();
  }
}
