/**
 * Pure timeline for the dialing sequence. No DOM, no audio.
 *
 * `buildDialPlan` turns a dial attempt (guess + feedback marks) into a fixed
 * schedule. `sampleRing(plan, t)` returns everything the ring should show at
 * time t, so the animation is a pure function of elapsed time: skipping just
 * means sampling at `plan.totalMs`, and sound is scheduled from the same plan.
 */

/** How a dialled glyph lands: right place, wrong place, or not in the address. */
export type Mark = 'locked' | 'drifting' | 'absent';

import { FAMILIES, GLYPH_IDS, type GlyphId } from './glyphs';

export const GLYPH_STEP_DEG = 360 / GLYPH_IDS.length;

/** Order of the glyphs around the ring: grouped by family, so each family is one arc. */
export const RING_ORDER: readonly GlyphId[] = FAMILIES.flatMap((f) => f.glyphs);

export interface DialTiming {
  /** Rim lights up and the hum builds before the first turn. */
  powerUpMs: number;
  /** Rotation duration = base + perDeg * |degrees travelled|. */
  rotateBaseMs: number;
  rotatePerDegMs: number;
  /** Keystone slams down onto the glyph. */
  engageMs: number;
  /** Result shown while the keystone is held down. */
  holdMs: number;
  /** Keystone lifts off before the next turn. */
  releaseMs: number;
  /** Closing sequence after the last chevron. */
  finaleSuccessMs: number;
  finaleFailMs: number;
}

export const DEFAULT_TIMING: DialTiming = {
  powerUpMs: 450,
  rotateBaseMs: 230,
  rotatePerDegMs: 1.0,
  engageMs: 90,
  holdMs: 180,
  releaseMs: 90,
  finaleSuccessMs: 3200,
  finaleFailMs: 700,
};

/** Near-instant variant for players who prefer reduced motion. */
export const REDUCED_TIMING: DialTiming = {
  powerUpMs: 0,
  rotateBaseMs: 0,
  rotatePerDegMs: 0,
  engageMs: 0,
  holdMs: 60,
  releaseMs: 0,
  finaleSuccessMs: 600,
  finaleFailMs: 300,
};

export interface DialStep {
  slot: number;
  glyph: GlyphId;
  mark: Mark;
  fromAngle: number;
  toAngle: number;
  rotateStart: number;
  rotateEnd: number;
  /** Keystone hits the glyph (impact moment). */
  impactAt: number;
  releaseStart: number;
  end: number;
}

export interface DialPlan {
  steps: DialStep[];
  success: boolean;
  startAngle: number;
  finalAngle: number;
  finaleStart: number;
  totalMs: number;
  slotCount: number;
}

/** Ring angle (degrees) that brings `glyph` under the keystone at the top. */
export function angleForGlyph(glyph: GlyphId): number {
  return -RING_ORDER.indexOf(glyph) * GLYPH_STEP_DEG;
}

/** Signed shortest rotation from `from` to `to` (mod 360), in (-180, 180]. */
export function shortestDelta(from: number, to: number): number {
  let d = (((to - from) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export function buildDialPlan(
  guess: readonly GlyphId[],
  marks: readonly Mark[],
  startAngle: number,
  timing: DialTiming = DEFAULT_TIMING,
): DialPlan {
  if (guess.length !== marks.length) throw new Error('guess/marks length mismatch');
  const steps: DialStep[] = [];
  let t = timing.powerUpMs;
  let angle = startAngle;
  guess.forEach((glyph, slot) => {
    const delta = shortestDelta(angle, angleForGlyph(glyph));
    const rotateMs = delta === 0 ? 0 : timing.rotateBaseMs + timing.rotatePerDegMs * Math.abs(delta);
    const rotateStart = t;
    const rotateEnd = rotateStart + rotateMs;
    const impactAt = rotateEnd + timing.engageMs;
    const releaseStart = impactAt + timing.holdMs;
    const end = releaseStart + timing.releaseMs;
    steps.push({
      slot,
      glyph,
      mark: marks[slot] as Mark,
      fromAngle: angle,
      toAngle: angle + delta,
      rotateStart,
      rotateEnd,
      impactAt,
      releaseStart,
      end,
    });
    angle += delta;
    t = end;
  });
  const success = marks.length > 0 && marks.every((m) => m === 'locked');
  const finaleStart = t;
  return {
    steps,
    success,
    startAngle,
    finalAngle: angle,
    finaleStart,
    totalMs: finaleStart + (success ? timing.finaleSuccessMs : timing.finaleFailMs),
    slotCount: guess.length,
  };
}

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutQuad = (x: number) => 1 - (1 - x) * (1 - x);

/**
 * Progress curve for a heavy rotation: a small wind-back, a slow-building
 * heave, an overshoot past the mark and a damped settle. Returns progress
 * (0 at start, exactly 1 at the end; briefly <0 and >1 in between).
 * `degrees` is the travel, used to keep anticipation/overshoot a few degrees
 * regardless of distance.
 */
export function heavyRotation(u: number, degrees: number): number {
  const x = clamp01(u);
  const dist = Math.max(Math.abs(degrees), 1);
  const back = Math.min(0.08, 3 / dist);
  const over = Math.min(0.06, 2.5 / dist);
  if (x < 0.14) return -back * easeOutQuad(x / 0.14);
  if (x < 0.82) return -back + (1 + over + back) * easeInOutCubic((x - 0.14) / 0.68);
  const s = (x - 0.82) / 0.18;
  return 1 + over * Math.cos(s * Math.PI * 1.5) * (1 - s);
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** 'energy': the ring is fully charged (successful dial). */
export type ChevronLight = 'dark' | 'armed' | 'energy' | Mark;

export interface ChevronFrame {
  light: ChevronLight;
  /** 0..1 glow strength (flares on impact, then settles). */
  glow: number;
  glyph: GlyphId | null;
}

export interface RingFrame {
  angle: number;
  /** Normalized rotation speed 0..1, for grind visuals/sound. */
  speed: number;
  /** Keystone travel 0 (raised) .. 1 (fully engaged). */
  keystone: number;
  /** Mark of the glyph currently under the keystone, once struck. */
  keystoneMark: Mark | null;
  activeSlot: number | null;
  chevrons: ChevronFrame[];
  /** Rim light 0..1. */
  rim: number;
  /** Camera shake amplitude 0..1. */
  shake: number;
  /** Veil (portal) opening 0..1; only rises on success. */
  veil: number;
  /** Full-ring white flash at the moment of the burst, 0..1. */
  flash: number;
  /** Shockwave after the burst: 0..1 progress outward, or 0 when none. */
  shock: number;
  phase: 'powerup' | 'dialing' | 'finale' | 'done';
}

const IMPACT_SHAKE: Record<Mark, number> = { locked: 0.7, drifting: 0.45, absent: 0.3 };

function rotationAngle(step: DialStep, t: number): number {
  if (t <= step.rotateStart) return step.fromAngle;
  if (t >= step.rotateEnd) return step.toAngle;
  const u = (t - step.rotateStart) / (step.rotateEnd - step.rotateStart);
  return step.fromAngle + (step.toAngle - step.fromAngle) * heavyRotation(u, step.toAngle - step.fromAngle);
}

export function sampleRing(plan: DialPlan, tMs: number): RingFrame {
  const t = Math.max(0, Math.min(tMs, plan.totalMs));
  const chevrons: ChevronFrame[] = Array.from({ length: plan.slotCount }, () => ({
    light: 'dark' as ChevronLight,
    glow: 0,
    glyph: null,
  }));

  // Angle and speed.
  let angle = plan.startAngle;
  let activeStep: DialStep | null = null;
  for (const step of plan.steps) {
    if (t >= step.rotateStart) angle = rotationAngle(step, t);
    if (t >= step.rotateStart && t < step.end) activeStep = step;
  }
  let speed = 0;
  if (activeStep && t < activeStep.rotateEnd) {
    const dt = 8;
    const a2 = rotationAngle(activeStep, t + dt);
    speed = Math.min(1, Math.abs(a2 - angle) / dt / 0.45);
  }

  // Keystone travel.
  let keystone = 0;
  let keystoneMark: Mark | null = null;
  if (activeStep) {
    const s = activeStep;
    if (t >= s.rotateEnd && t < s.impactAt) {
      const u = (t - s.rotateEnd) / Math.max(1, s.impactAt - s.rotateEnd);
      keystone = u * u * u; // accelerate into the strike
    } else if (t >= s.impactAt && t < s.releaseStart) {
      keystone = 1;
      keystoneMark = s.mark;
    } else if (t >= s.releaseStart) {
      keystone = 1 - easeOutQuad((t - s.releaseStart) / Math.max(1, s.end - s.releaseStart));
      keystoneMark = s.mark;
    }
    if (s.impactAt === s.rotateEnd && t >= s.impactAt) keystoneMark = s.mark;
  }

  // Chevrons and shake.
  let shake = 0;
  for (const step of plan.steps) {
    const c = chevrons[step.slot]!;
    if (t >= step.impactAt) {
      const since = t - step.impactAt;
      c.light = step.mark;
      c.glyph = step.glyph;
      const settle = step.mark === 'absent' ? 0.25 : step.mark === 'drifting' ? 0.6 : 0.85;
      c.glow = settle + (1 - settle) * Math.exp(-since / 220);
      // Absent chevrons sputter briefly before going dim.
      if (step.mark === 'absent' && since < 300) c.glow *= 0.55 + 0.45 * Math.abs(Math.sin(since / 22));
      shake = Math.max(shake, IMPACT_SHAKE[step.mark] * Math.exp(-since / 90));
    } else if (t >= step.rotateStart) {
      c.light = 'armed';
      c.glow = 0.35 + 0.15 * Math.sin(t / 60);
    }
  }

  // Rim and phase.
  let phase: RingFrame['phase'];
  let rim: number;
  let veil = 0;
  let flash = 0;
  let shock = 0;
  const firstStart = plan.steps[0]?.rotateStart ?? plan.finaleStart;
  if (t < firstStart) {
    phase = 'powerup';
    const u = firstStart === 0 ? 1 : t / firstStart;
    // Lights stutter on, like a heavy machine waking.
    rim = clamp01(u) * (u < 0.6 ? 0.5 + 0.5 * Math.abs(Math.sin(u * 40)) : 1);
  } else if (t < plan.finaleStart) {
    phase = 'dialing';
    rim = 1;
  } else {
    const dur = plan.totalMs - plan.finaleStart;
    const u = dur === 0 ? 1 : (t - plan.finaleStart) / dur;
    phase = t >= plan.totalMs ? 'done' : 'finale';
    if (plan.success) {
      rim = 1;
      // Gather, a held breath, then burst open and settle.
      const burstAt = burstTime(plan);
      const since = t - burstAt;
      veil = u < 0.25 ? 0 : easeOutQuad(clamp01((u - 0.25) / 0.45));
      const burst = since >= 0 ? Math.exp(-since / 300) : 0;
      if (since < 0 && since > -BREATH_MS) {
        // The breath: everything goes still and the lights sink.
        shake = 0;
        rim = 0.45;
      } else {
        shake = Math.max(shake, 1.6 * burst, u < 0.25 ? 0.25 * (u / 0.25) : 0);
      }
      flash = since >= 0 ? Math.exp(-since / 140) : 0;
      shock = since >= 0 && since <= SHOCK_MS ? since / SHOCK_MS : 0;
      // Charge cascade: chevrons turn from locked green to energy, one by
      // one in slot order, the last converting just before the burst.
      chevrons.forEach((c, i) => {
        if (t >= chargeTime(plan, i)) c.light = 'energy';
        c.glow = Math.max(c.glow, u < 0.25 ? 0.85 + 0.15 * Math.sin(t / 40) : 1);
      });
    } else {
      rim = 1 - 0.65 * easeOutQuad(clamp01(u));
    }
  }

  return {
    angle,
    speed,
    keystone,
    keystoneMark,
    activeSlot: activeStep ? activeStep.slot : null,
    chevrons,
    rim,
    shake,
    veil,
    flash,
    shock,
    phase,
  };
}

/** Held stillness before the burst (ms). */
export const BREATH_MS = 140;
/** How long the shockwave takes to sweep out (ms). */
export const SHOCK_MS = 750;

/** Moment the veil bursts open on a successful dial. */
export function burstTime(plan: DialPlan): number {
  return plan.finaleStart + (plan.totalMs - plan.finaleStart) * 0.25;
}

/**
 * The mark each slot has revealed so far in this frame (null until its
 * chevron is struck). Energy chevrons count as locked.
 */
export function revealedMarks(frame: RingFrame): (Mark | null)[] {
  return frame.chevrons.map((c) => (c.light === 'energy' ? 'locked' : c.light === 'dark' || c.light === 'armed' ? null : c.light));
}

/** When chevron `slot` converts to energy during a successful finale. */
export function chargeTime(plan: DialPlan, slot: number): number {
  const gather = (plan.totalMs - plan.finaleStart) * 0.25;
  return plan.finaleStart + (gather * (slot + 1)) / (plan.slotCount + 1);
}

/** Normalized speed sampled at a fixed interval across the whole plan (for audio). */
export function speedCurve(plan: DialPlan, intervalMs: number): Float32Array {
  const n = Math.max(2, Math.ceil(plan.totalMs / intervalMs) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = sampleRing(plan, i * intervalMs).speed;
  return out;
}
