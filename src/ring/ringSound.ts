/**
 * Synthesized sound for the ring. No audio files: everything is built from
 * oscillators and filtered noise with the Web Audio API.
 *
 * Mood: ancient and enormous. Everything sits in D (Phrygian colour), with a
 * deep drone, breathy formant "choir" voices and a long dark stone-hall
 * reverb. Each locked chevron adds a sustained choir voice, so the chord
 * builds over the dial; a failed dial lets it sag and die, a successful one
 * swells into a blast.
 *
 * A whole dial is scheduled up front from the same `DialPlan` the animation
 * samples, so sound and motion stay locked together on the audio clock.
 * Works with an OfflineAudioContext too (used to verify levels).
 * Noise buffers come from the seeded game RNG so nothing here uses
 * Math.random.
 */

import { Rng } from '../game/rng';
import { BREATH_MS, type DialPlan, GLYPH_STEP_DEG, type Mark, chargeTime, sampleRing } from './ringTimeline';

const MIN = 0.0001;

/** Note frequencies (Hz). */
const D1 = 36.71;
const D2 = 73.42;
const A2 = 110.0;
const D3 = 146.83;
const E3 = 164.81;
const F3 = 174.61;
const A3 = 220.0;
const C4 = 261.63;
const EB4 = 311.13;

/** Choir voice added for each successive lock: a dark, widening chord. */
const LOCK_CHORD = [D2, A2, D3, F3, A3, C4, EB4];
/** Rising chimes as chevrons charge on success (D minor arpeggio). */
const CHARGE_NOTES = [587.33, 698.46, 880.0, 1174.66, 1396.91, 1760.0, 2349.32];

type Vowel = 'ah' | 'oo';
const FORMANTS: Record<Vowel, [number, number][]> = {
  ah: [[730, 1], [1090, 0.5], [2440, 0.22]],
  oo: [[300, 1], [870, 0.35], [2240, 0.12]],
};

export interface Voice {
  /** Fade out and cut everything this voice scheduled. */
  stop(fadeSec?: number): void;
}

type Sources = AudioScheduledSourceNode[];

interface ChoirVoice {
  level: GainNode;
  oscs: OscillatorNode[];
}

export class RingSound {
  readonly ctx: BaseAudioContext;
  private readonly master: GainNode;
  /** Whole-mix gate, dipped for the held breath before a burst (reverb included). */
  private readonly gate: GainNode;
  private readonly bus: GainNode;
  /** Saturated bus for sub-bass hits, so they read on small speakers. */
  private readonly heavy: GainNode;
  private readonly reverbSend: GainNode;
  private readonly noise: AudioBuffer;
  private enabled = true;

  constructor(ctx: BaseAudioContext, destination: AudioNode = ctx.destination) {
    this.ctx = ctx;
    const rng = new Rng('ring-sound');

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = rng.next() * 2 - 1;

    // Gentle, slow-attack compression: glues the mix without flattening strikes.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.015;
    comp.release.value = 0.3;

    // Final safety limiter so the blast never clips.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.gate = ctx.createGain();
    comp.connect(this.gate).connect(this.master).connect(limiter).connect(destination);

    this.bus = ctx.createGain();
    this.bus.connect(comp);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(2.6 * x) / Math.tanh(2.6);
    }
    shaper.curve = curve;
    shaper.oversample = '4x';
    this.heavy = ctx.createGain();
    const heavyOut = ctx.createGain();
    heavyOut.gain.value = 0.62;
    this.heavy.connect(shaper).connect(heavyOut).connect(comp);

    // Vast, dark stone hall: long decaying stereo noise impulse with a short
    // pre-delay, high-passed and darkened so it never muddies the strikes.
    const convolver = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 4.2);
    const pre = Math.floor(ctx.sampleRate * 0.025);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = pre; i < len; i++) d[i] = (rng.next() * 2 - 1) * Math.pow(1 - (i - pre) / (len - pre), 2.6);
    }
    convolver.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.32;
    const verbHp = ctx.createBiquadFilter();
    verbHp.type = 'highpass';
    verbHp.frequency.value = 160;
    const verbLp = ctx.createBiquadFilter();
    verbLp.type = 'lowpass';
    verbLp.frequency.value = 3800;
    this.reverbSend.connect(verbHp).connect(convolver).connect(verbLp).connect(comp);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.02);
  }

  isEnabled() {
    return this.enabled;
  }

  // -------------------------------------------------------------------------
  // Building blocks
  // -------------------------------------------------------------------------

  private newVoice(): { out: GainNode; heavy: GainNode; sources: Sources; voice: Voice } {
    const out = this.ctx.createGain();
    out.connect(this.bus);
    out.connect(this.reverbSend);
    const heavy = this.ctx.createGain();
    heavy.connect(this.heavy);
    heavy.connect(this.reverbSend);
    const sources: Sources = [];
    const voice: Voice = {
      stop: (fadeSec = 0.12) => {
        const now = this.ctx.currentTime;
        // Cancel any pending breath dip so it cannot fire after a skip.
        this.gate.gain.cancelScheduledValues(now);
        this.gate.gain.setValueAtTime(1, now);
        for (const g of [out, heavy]) {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0, now + fadeSec);
        }
        for (const s of sources) {
          try {
            s.stop(now + fadeSec + 0.02);
          } catch {
            /* already stopped */
          }
        }
        setTimeout(() => {
          out.disconnect();
          heavy.disconnect();
        }, (fadeSec + 0.1) * 1000);
      },
    };
    return { out, heavy, sources, voice };
  }

  private gain(dest: AudioNode | AudioParam, value = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (dest instanceof AudioParam) g.connect(dest);
    else g.connect(dest);
    return g;
  }

  private filter(dest: AudioNode, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  private osc(dest: AudioNode, src: Sources, type: OscillatorType, freq: number, start: number, stop: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    o.connect(dest);
    o.start(start);
    o.stop(stop);
    src.push(o);
    return o;
  }

  private noiseSrc(dest: AudioNode, src: Sources, start: number, stop: number, offset = 0): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    n.connect(dest);
    n.start(start, Math.abs(offset) % 2);
    n.stop(stop);
    src.push(n);
    return n;
  }

  /** Percussive envelope on a fresh gain node. */
  private hit(dest: AudioNode, t: number, peak: number, decay: number, attack = 0.004): GainNode {
    const g = this.gain(dest, 0);
    g.gain.setValueAtTime(MIN, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(MIN, t + attack + decay);
    return g;
  }

  /** Pitch-dropping sine: the felt weight of a blow. */
  private drop(dest: AudioNode, src: Sources, t: number, peak: number, from: number, to: number, decay: number) {
    const g = this.hit(dest, t, peak, decay);
    const o = this.osc(g, src, 'sine', from, t, t + decay + 0.05);
    o.frequency.exponentialRampToValueAtTime(to, t + Math.min(0.3, decay * 0.4));
  }

  /** Filtered noise burst. */
  private burst(dest: AudioNode, src: Sources, t: number, peak: number, type: BiquadFilterType, freq: number, decay: number, q = 0.8, attack = 0.002) {
    const g = this.hit(dest, t, peak, decay, attack);
    this.noiseSrc(this.filter(g, type, freq, q), src, t, t + attack + decay + 0.05, t * 7.3);
  }

  /** Large struck metal: deep, inharmonic, long. */
  private gong(dest: AudioNode, src: Sources, t: number, base: number, peak: number, decay: number) {
    const partials: [number, number][] = [[1, 1], [1.47, 0.6], [2.09, 0.45], [2.56, 0.3], [3.37, 0.2], [4.8, 0.1]];
    for (const [ratio, amp] of partials) {
      const g = this.hit(dest, t, peak * amp, decay / Math.sqrt(ratio), 0.006);
      const o = this.osc(g, src, 'sine', base * ratio, t, t + decay + 0.1);
      o.detune.value = (ratio - 1) * 3; // slight stretch for a living shimmer
    }
  }

  /** A breathy formant voice: three detuned saws (plus breath) through vowel filters. */
  private choir(dest: AudioNode, src: Sources, freq: number, start: number, stop: number, vowel: Vowel = 'ah'): ChoirVoice {
    const level = this.gain(dest, 0);
    const mix = this.ctx.createGain();
    mix.gain.value = 0.33;
    for (const [f, amp] of FORMANTS[vowel]) mix.connect(this.filter(this.gain(level, amp * 3), 'bandpass', f, 9));
    const vibrato = this.ctx.createGain();
    vibrato.gain.value = 7; // cents
    const oscs = [-9, 0, 8].map((cents) => {
      const o = this.osc(mix, src, 'sawtooth', freq, start, stop);
      o.detune.value = cents;
      vibrato.connect(o.detune);
      return o;
    });
    this.osc(vibrato, src, 'sine', 4.6 + (freq % 1), start, stop);
    this.noiseSrc(this.gain(mix, 0.12), src, start, stop, freq);
    return { level, oscs };
  }

  // -------------------------------------------------------------------------
  // The dial sequence
  // -------------------------------------------------------------------------

  scheduleDial(plan: DialPlan, startAt: number = this.ctx.currentTime + 0.03): Voice {
    const { out, heavy, sources: src, voice } = this.newVoice();
    const T = (ms: number) => startAt + ms / 1000;
    const end = T(plan.totalMs);
    const tail = plan.success ? 4.5 : 1.8;
    const firstTurn = T(plan.steps[0]?.rotateStart ?? plan.finaleStart);

    // --- Background bed, ducked under every strike for contrast. ---
    const bed = this.gain(out, 1);
    bed.gain.setValueAtTime(1, startAt);
    for (const step of plan.steps) {
      const t = T(step.impactAt);
      bed.gain.setValueAtTime(1, t - 0.005);
      bed.gain.linearRampToValueAtTime(0.2, t + 0.01);
      bed.gain.setTargetAtTime(1, t + 0.12, 0.18);
    }

    // --- Awakening: an indrawn swell, the sub rising out of nothing. ---
    {
      const g = this.gain(out, 0);
      g.gain.setValueAtTime(MIN, startAt);
      g.gain.exponentialRampToValueAtTime(0.22, firstTurn);
      g.gain.exponentialRampToValueAtTime(MIN, firstTurn + 0.06);
      const bp = this.filter(g, 'bandpass', 250, 1.2);
      bp.frequency.setValueAtTime(250, startAt);
      bp.frequency.exponentialRampToValueAtTime(1800, firstTurn);
      this.noiseSrc(bp, src, startAt, firstTurn + 0.1);
      this.drop(heavy, src, firstTurn, 0.7, 90, 30, 0.9);
    }

    // Drone: D1 + D2 with a slow beat, low-passed. Present throughout.
    const drone = this.gain(bed, 0);
    drone.gain.setValueAtTime(0, startAt);
    drone.gain.linearRampToValueAtTime(0.16, firstTurn + 0.2);
    const droneLp = this.filter(drone, 'lowpass', 220, 1.5);
    const droneOscs = ([[D1, 'sine', 0.8], [D2, 'sawtooth', 0.3], [D2 * 1.006, 'sawtooth', 0.3]] as const).map(([f, type, lvl]) =>
      this.osc(this.gain(droneLp, lvl), src, type, f, startAt, end + tail),
    );
    // Faint breath of a choir behind the machine.
    const breathChoir = this.choir(bed, src, D3, startAt, end + tail, 'oo');
    breathChoir.level.gain.setValueAtTime(0, startAt);
    breathChoir.level.gain.linearRampToValueAtTime(0.025, firstTurn + 0.8);

    // --- Rotation: stone grinding (irregular), deep rumble, ratchet. ---
    const curveStep = 0.02;
    const speed = new Float32Array(Math.max(2, Math.ceil(plan.totalMs / (curveStep * 1000)) + 1));
    for (let i = 0; i < speed.length; i++) speed[i] = sampleRing(plan, i * curveStep * 1000).speed;
    const curveDur = (speed.length - 1) * curveStep;
    const scaled = (k: number, offset = 0) => speed.map((s) => offset + s * k);

    const grind = this.gain(bed, 0);
    grind.gain.setValueCurveAtTime(scaled(0.9), startAt, curveDur);
    // Irregular grain: slow random amplitude wobble, like stone catching.
    const grain = this.gain(grind, 0.6);
    const grainMod = this.gain(grain.gain, 6);
    this.noiseSrc(this.filter(grainMod, 'lowpass', 25), src, startAt, startAt + curveDur + 0.05, 0.7);
    const grindBand = this.filter(grain, 'bandpass', 200, 1.3);
    grindBand.frequency.setValueCurveAtTime(scaled(260, 110), startAt, curveDur);
    this.noiseSrc(grindBand, src, startAt, startAt + curveDur + 0.05);

    const rumble = this.gain(heavy, 0);
    rumble.gain.setValueCurveAtTime(scaled(0.32), startAt, curveDur);
    const rumbleOsc = this.osc(this.filter(rumble, 'lowpass', 160, 1.4), src, 'sawtooth', 32, startAt, startAt + curveDur + 0.05);
    rumbleOsc.frequency.setValueCurveAtTime(scaled(14, 30), startAt, curveDur);

    // Ratchet: a deep stone "tock" as each glyph passes the keystone.
    {
      let prev = Math.floor(plan.startAngle / GLYPH_STEP_DEG);
      for (let ms = 0; ms <= plan.finaleStart; ms += 4) {
        const f = sampleRing(plan, ms);
        const idx = Math.floor((f.angle + GLYPH_STEP_DEG / 2) / GLYPH_STEP_DEG);
        if (idx !== prev) {
          const t = T(ms);
          const lvl = 0.25 + 0.35 * f.speed;
          this.burst(bed, src, t, lvl, 'bandpass', 720, 0.05, 4);
          const g = this.hit(bed, t, lvl * 0.8, 0.07);
          this.osc(g, src, 'sine', 170, t, t + 0.1);
          prev = idx;
        }
      }
    }

    // --- Each chevron. ---
    const lockVoices: ChoirVoice[] = [];
    for (const step of plan.steps) {
      const hitAt = T(step.impactAt);
      // Indrawn breath into the strike.
      const inhaleFrom = Math.max(T(step.rotateStart), hitAt - 0.32);
      if (hitAt - inhaleFrom > 0.05) {
        const g = this.gain(out, 0);
        g.gain.setValueAtTime(MIN, inhaleFrom);
        g.gain.exponentialRampToValueAtTime(0.16, hitAt - 0.005);
        g.gain.linearRampToValueAtTime(0, hitAt + 0.005);
        const bp = this.filter(g, 'bandpass', 500, 2);
        bp.frequency.setValueAtTime(500, inhaleFrom);
        bp.frequency.exponentialRampToValueAtTime(2600, hitAt);
        this.noiseSrc(bp, src, inhaleFrom, hitAt + 0.02, step.slot);
      }
      this.impact(out, heavy, src, hitAt, step.mark);
      if (step.mark === 'locked') {
        const note = LOCK_CHORD[Math.min(lockVoices.length, LOCK_CHORD.length - 1)]!;
        const v = this.choir(out, src, note, hitAt, end + tail, 'ah');
        v.level.gain.setValueAtTime(0, hitAt);
        v.level.gain.linearRampToValueAtTime(0.055, hitAt + 0.5);
        lockVoices.push(v);
      }
      // Keystone lifts: a low pneumatic exhale.
      if (step.end > step.releaseStart) this.burst(out, src, T(step.releaseStart), 0.05, 'bandpass', 900, 0.18, 1.5, 0.03);
    }

    // --- Finale. ---
    const fStart = T(plan.finaleStart);
    if (plan.success) {
      this.successFinale(out, heavy, src, plan, startAt, end, drone, lockVoices);
    } else {
      // The chord sags and dies; the drone sinks; a long exhale.
      const fade = end + 1.4;
      for (const v of lockVoices) {
        v.level.gain.setValueAtTime(0.055, fStart);
        v.level.gain.linearRampToValueAtTime(0, fade);
        for (const o of v.oscs) {
          o.detune.setValueAtTime(o.detune.value, fStart);
          o.detune.linearRampToValueAtTime(o.detune.value - 250, fade);
        }
      }
      drone.gain.setValueAtTime(0.16, fStart);
      drone.gain.linearRampToValueAtTime(0, fade);
      for (const o of droneOscs) {
        o.detune.setValueAtTime(0, fStart);
        o.detune.linearRampToValueAtTime(-700, fade);
      }
      breathChoir.level.gain.setValueAtTime(0.025, fStart);
      breathChoir.level.gain.linearRampToValueAtTime(0, fade);
      this.drop(heavy, src, fStart + 0.05, 0.6, 70, 26, 1.2);
      const g = this.hit(out, fStart, 0.12, 1.3, 0.15);
      const bp = this.filter(g, 'bandpass', 1500, 1.5);
      bp.frequency.setValueAtTime(1500, fStart);
      bp.frequency.exponentialRampToValueAtTime(180, fStart + 1.4);
      this.noiseSrc(bp, src, fStart, fStart + 1.5, 1.1);
    }
    return voice;
  }

  private impact(out: AudioNode, heavy: AudioNode, src: Sources, t: number, mark: Mark) {
    const dead = mark === 'absent';
    // Every strike: saturated sub drop, body, crack.
    this.drop(heavy, src, t, dead ? 0.75 : 1.0, 160, 30, dead ? 0.7 : 1.1);
    this.burst(out, src, t, dead ? 0.35 : 0.55, 'lowpass', dead ? 380 : 750, 0.2);
    if (!dead) this.burst(out, src, t, 0.32, 'highpass', 2600, 0.025);

    if (mark === 'locked') {
      this.gong(out, src, t + 0.01, 82.4, 0.2, 2.8);
    } else if (mark === 'drifting') {
      // Catches, rings dissonant, scrapes free.
      const g = this.hit(out, t, 0.07, 1.4, 0.01);
      this.osc(g, src, 'sine', 466.16, t, t + 1.5);
      this.osc(g, src, 'sine', 493.88, t, t + 1.5);
      const sg = this.hit(out, t + 0.05, 0.22, 0.45, 0.02);
      const bp = this.filter(sg, 'bandpass', 1400, 6);
      bp.frequency.setValueAtTime(1400, t + 0.05);
      bp.frequency.exponentialRampToValueAtTime(260, t + 0.5);
      this.noiseSrc(bp, src, t + 0.05, t + 0.55, t * 3.1);
    } else {
      // Fails to seat: a low groan a semitone apart, and a sputter.
      const g = this.hit(out, t + 0.02, 0.2, 1.0, 0.04);
      const lp = this.filter(g, 'lowpass', 320, 2);
      for (const f of [49, 51.9]) {
        const o = this.osc(lp, src, 'sawtooth', f, t + 0.02, t + 1.1);
        o.frequency.exponentialRampToValueAtTime(f * 0.85, t + 1.0);
      }
      for (let i = 0; i < 4; i++) this.burst(out, src, t + 0.06 + i * 0.05, 0.08 / (i + 1), 'bandpass', 3800, 0.02, 2);
    }
  }

  private successFinale(
    out: AudioNode,
    heavy: AudioNode,
    src: Sources,
    plan: DialPlan,
    startAt: number,
    end: number,
    drone: GainNode,
    lockVoices: ChoirVoice[],
  ) {
    const T = (ms: number) => startAt + ms / 1000;
    const start = T(plan.finaleStart);
    const dur = end - start;
    const burst = start + dur * 0.25;
    // A held breath just before the burst: everything cuts out, then the boom.
    const hold = burst - BREATH_MS / 1000;
    const cut = hold + 0.03;
    this.gate.gain.setValueAtTime(1, hold);
    this.gate.gain.linearRampToValueAtTime(0.04, cut);
    this.gate.gain.setValueAtTime(0.04, burst - 0.002);
    this.gate.gain.linearRampToValueAtTime(1, burst);

    // Charge cascade: a rising chime as each chevron turns blue.
    for (let i = 0; i < plan.slotCount; i++) {
      const t = T(chargeTime(plan, i));
      const f = CHARGE_NOTES[Math.min(i, CHARGE_NOTES.length - 1)]!;
      const g = this.hit(out, t, 0.09, 1.6, 0.01);
      const o = this.osc(g, src, 'sine', f * 0.94, t, t + 1.7);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      const g2 = this.hit(out, t, 0.03, 1.0, 0.01);
      this.osc(g2, src, 'triangle', f * 2.01, t, t + 1.1);
      this.drop(heavy, src, t, 0.35, 110, 45, 0.35);
    }

    // Everything draws in: noise swell, rising sub and saws, choir crescendo.
    {
      const g = this.gain(out, 0);
      g.gain.setValueAtTime(MIN, start);
      g.gain.exponentialRampToValueAtTime(0.4, hold);
      g.gain.exponentialRampToValueAtTime(MIN, cut);
      const lp = this.filter(g, 'lowpass', 200, 1.5);
      lp.frequency.setValueAtTime(200, start);
      lp.frequency.exponentialRampToValueAtTime(7000, hold);
      this.noiseSrc(lp, src, start, burst);
    }
    {
      const g = this.gain(heavy, 0);
      g.gain.setValueAtTime(MIN, start);
      g.gain.exponentialRampToValueAtTime(0.45, hold);
      g.gain.exponentialRampToValueAtTime(MIN, cut);
      const o = this.osc(g, src, 'sine', 28, start, burst);
      o.frequency.exponentialRampToValueAtTime(65, hold);
      const lp = this.filter(this.gain(g, 0.5), 'lowpass', 900);
      for (const f of [D2, A2]) {
        const s = this.osc(lp, src, 'sawtooth', f, start, burst);
        s.frequency.exponentialRampToValueAtTime(f * 2, hold);
      }
    }
    for (const v of lockVoices) {
      v.level.gain.setValueAtTime(0.055, start);
      v.level.gain.linearRampToValueAtTime(0.11, hold);
      v.level.gain.linearRampToValueAtTime(0, cut);
      v.level.gain.setValueAtTime(0, burst);
      v.level.gain.linearRampToValueAtTime(0.1, burst + 0.04);
      v.level.gain.linearRampToValueAtTime(0.05, burst + 0.8);
      v.level.gain.setValueAtTime(0.05, end);
      v.level.gain.linearRampToValueAtTime(0, end + 4);
    }
    drone.gain.setValueAtTime(0.16, start);
    drone.gain.linearRampToValueAtTime(0.3, hold);
    drone.gain.linearRampToValueAtTime(0, cut);
    drone.gain.setValueAtTime(0, burst);
    drone.gain.linearRampToValueAtTime(0.32, burst + 0.03);
    drone.gain.linearRampToValueAtTime(0.14, burst + 1);
    drone.gain.setValueAtTime(0.14, end);
    drone.gain.linearRampToValueAtTime(0, end + 4);

    // The blast: a brassy low roar whose filter flares then closes, a huge
    // sub boom, crack and air, and a giant gong.
    {
      const g = this.gain(heavy, 0);
      g.gain.setValueAtTime(MIN, burst);
      g.gain.exponentialRampToValueAtTime(0.5, burst + 0.03);
      g.gain.exponentialRampToValueAtTime(0.12, burst + 1.2);
      g.gain.exponentialRampToValueAtTime(MIN, burst + 3.4);
      const lp = this.filter(g, 'lowpass', 300, 3);
      lp.frequency.setValueAtTime(300, burst);
      lp.frequency.exponentialRampToValueAtTime(2400, burst + 0.06);
      lp.frequency.exponentialRampToValueAtTime(260, burst + 2.6);
      for (const [f, cents] of [[D1, 0], [D2, -7], [D2, 7], [A2, 0], [D3, -5], [D3, 5]] as const) {
        const o = this.osc(lp, src, 'sawtooth', f, burst, burst + 3.5);
        o.detune.value = cents;
      }
    }
    this.drop(heavy, src, burst, 1.0, 75, 22, 3.2);
    // A second, deeper body blow a beat later: the ground answering.
    this.drop(heavy, src, burst + 0.09, 0.7, 48, 18, 2.6);
    this.burst(out, src, burst, 0.45, 'highpass', 2400, 0.05);
    this.burst(out, src, burst, 0.55, 'lowpass', 1600, 1.8, 0.5, 0.01);
    this.gong(out, src, burst + 0.02, 41.2, 0.3, 5);

    // The open veil: a still, choral D sus chord with a high glassy shimmer
    // and a slow sub pulse.
    for (const [f, vowel] of [[D2, 'oo'], [A2, 'ah'], [D3, 'ah'], [E3, 'oo'], [A3, 'ah']] as const) {
      const v = this.choir(out, src, f, burst, end + 4.2, vowel);
      v.level.gain.setValueAtTime(0, burst);
      v.level.gain.linearRampToValueAtTime(0.045, burst + 1.2);
      v.level.gain.setValueAtTime(0.045, end);
      v.level.gain.linearRampToValueAtTime(0, end + 4);
    }
    const shimmer = this.gain(out, 0);
    shimmer.gain.setValueAtTime(0, burst);
    shimmer.gain.linearRampToValueAtTime(0.02, burst + 1.5);
    shimmer.gain.setValueAtTime(0.02, end);
    shimmer.gain.linearRampToValueAtTime(0, end + 3.5);
    const trem = this.gain(shimmer.gain, 0.01);
    this.osc(trem, src, 'sine', 3.7, burst, end + 3.6);
    this.osc(shimmer, src, 'sine', 1174.66, burst, end + 3.6);
    this.osc(shimmer, src, 'sine', 1760.0, burst, end + 3.6);
    const pulse = this.gain(heavy, 0);
    pulse.gain.setValueAtTime(0, burst + 0.8);
    pulse.gain.linearRampToValueAtTime(0.18, burst + 1.6);
    pulse.gain.setValueAtTime(0.18, end);
    pulse.gain.linearRampToValueAtTime(0, end + 3.5);
    const pulseLfo = this.gain(pulse.gain, 0.12);
    this.osc(pulseLfo, src, 'sine', 0.55, burst, end + 3.6);
    this.osc(pulse, src, 'sine', D1, burst, end + 3.6);
  }

  /** Condensed ending, used when the player skips the sequence. */
  scheduleSkipEnding(success: boolean, startAt: number = this.ctx.currentTime + 0.02): Voice {
    const { out, heavy, sources: src, voice } = this.newVoice();
    if (success) {
      this.drop(heavy, src, startAt, 1.0, 75, 22, 2.6);
      this.burst(out, src, startAt, 0.5, 'lowpass', 1600, 1.4, 0.5, 0.01);
      this.gong(out, src, startAt + 0.02, 41.2, 0.3, 4);
    } else {
      this.drop(heavy, src, startAt, 0.9, 150, 30, 0.9);
      this.burst(out, src, startAt, 0.4, 'lowpass', 600, 0.2);
    }
    return voice;
  }
}
