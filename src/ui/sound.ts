/**
 * Sound hooks. Every cue the game makes goes through `cue(name)`, so real
 * audio can replace these synthesised placeholders later without touching
 * the game screens.
 */

import { Rng } from '../game/rng';

export type Cue = 'incoming' | 'tick' | 'open' | 'close' | 'clank' | 'thud' | 'correct' | 'wrong' | 'alarm' | 'collapse' | 'print' | 'radio' | 'lever' | 'paper' | 'click';

const KEY = 'shutter-duty.sound';
/** Noise grain also comes from the seeded RNG; nothing in the game uses Math.random. */
const grain = new Rng('sound-grain');
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
})();

export function soundOn(): boolean {
  return enabled;
}

export function setSound(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* not saved; fine */
  }
}

/** The shared audio context (also used by the ring's sound), or null when sound is off or unavailable. */
export function audioContext(): AudioContext | null {
  return audio()?.ctx ?? null;
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (!enabled) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return { ctx, out: master! };
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, at = 0, glideTo?: number) {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + at;
  const o = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol: number, at = 0, from = 800, to = 200) {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + at;
  const buf = a.ctx.createBuffer(1, Math.ceil(a.ctx.sampleRate * dur), a.ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = grain.next() * 2 - 1;
  const src = a.ctx.createBufferSource();
  src.buffer = buf;
  const f = a.ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(a.out);
  src.start(t);
}

export function cue(name: Cue) {
  switch (name) {
    case 'incoming':
      noise(1.1, 0.5, 0, 200, 2400);
      tone(55, 1.2, 'sine', 0.35, 0, 110);
      break;
    case 'collapse':
      noise(0.6, 0.3, 0, 2000, 120);
      break;
    case 'tick':
      tone(1400, 0.05, 'square', 0.06);
      break;
    case 'open':
      tone(90, 0.7, 'sawtooth', 0.08, 0, 160);
      noise(0.7, 0.15, 0, 600, 300);
      break;
    case 'close':
      tone(160, 0.5, 'sawtooth', 0.08, 0, 80);
      break;
    case 'clank':
      noise(0.25, 0.6, 0, 3000, 200);
      tone(70, 0.35, 'sine', 0.5);
      break;
    case 'thud':
      for (let i = 0; i < 3; i++) {
        tone(48, 0.25, 'sine', 0.6, i * 0.32);
        noise(0.12, 0.25, i * 0.32, 400, 80);
      }
      break;
    case 'correct':
      tone(660, 0.15, 'sine', 0.15);
      tone(990, 0.3, 'sine', 0.12, 0.1);
      break;
    case 'wrong':
      tone(140, 0.4, 'square', 0.08);
      break;
    case 'print':
      for (let i = 0; i < 9; i++) noise(0.05, 0.18, i * 0.09, 5000, 2500);
      tone(220, 0.8, 'square', 0.015, 0, 200);
      break;
    case 'radio':
      noise(0.5, 0.22, 0, 6000, 1800);
      tone(1000, 0.08, 'sine', 0.05, 0.45);
      break;
    case 'lever':
      noise(0.18, 0.4, 0, 2500, 300);
      tone(95, 0.3, 'sine', 0.35, 0.05);
      break;
    case 'paper':
      noise(0.12, 0.08, 0, 4000, 1500);
      break;
    case 'click':
      tone(1800, 0.03, 'square', 0.04);
      break;
    case 'alarm':
      for (let i = 0; i < 4; i++) tone(i % 2 ? 620 : 470, 0.22, 'sawtooth', 0.09, i * 0.24);
      break;
  }
}
