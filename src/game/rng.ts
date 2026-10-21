/**
 * The single source of randomness. Every random decision (reference sheets,
 * arrivals, gaps between arrivals, cosmetic effects) goes through an `Rng`,
 * so a shift can be replayed exactly from its seed. Sub-systems get their own
 * stream via `deriveSeed(seed, label)`.
 *
 * Algorithm: mulberry32. String seeds are hashed with FNV-1a.
 */

export type Seed = number | string;

/** Hash any seed to an unsigned 32-bit integer. */
export function hashSeed(seed: Seed): number {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Derive an independent stream seed for a named sub-system. */
export function deriveSeed(seed: Seed, label: string): number {
  return hashSeed(`${hashSeed(seed)}:${label}`);
}

export class Rng {
  private state: number;

  constructor(seed: Seed) {
    this.state = hashSeed(seed);
  }

  /** Restore an Rng from a saved state (see `getState`). */
  static fromState(state: number): Rng {
    const rng = new Rng(0);
    rng.state = state >>> 0;
    return rng;
  }

  getState(): number {
    return this.state;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: max (${max}) < min (${min})`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Returns a shuffled copy (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /** `count` distinct items in random order. */
  sample<T>(items: readonly T[], count: number): T[] {
    if (count > items.length) throw new Error('Rng.sample: count exceeds items');
    return this.shuffle(items).slice(0, count);
  }
}
