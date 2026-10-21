import { describe, expect, it } from 'vitest';
import { brokenRules, makeArrival, nextArrival } from '../src/game/arrivals';
import { buildReference, campaignTeams } from '../src/game/reference';
import { MAX_DAY, RULES, activeRules, entryFor, hamming, judge, nearMiss } from '../src/game/rules';
import { Rng } from '../src/game/rng';
import type { Intent } from '../src/game/types';

const SEEDS = Array.from({ length: 25 }, (_, i) => `seed-${i}`);

describe('rules', () => {
  it('one new rule a day, seven days', () => {
    expect(RULES.map((r) => r.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (let d = 1; d <= MAX_DAY; d++) expect(activeRules(d)).toHaveLength(d);
  });
});

describe('reference sheets', () => {
  it('are reproducible from the seed', () => {
    expect(buildReference('same', 5)).toEqual(buildReference('same', 5));
  });

  it('keep codes far apart, so a one-character forgery points at exactly one real code', () => {
    for (const seed of SEEDS) {
      for (let d = 1; d <= MAX_DAY; d++) {
        const codes = buildReference(seed, d).codes.map((c) => c.code);
        for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) expect(hamming(codes[i]!, codes[j]!)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('can always produce every outcome in force that day', () => {
    for (const seed of SEEDS) {
      for (let d = 1; d <= MAX_DAY; d++) {
        const ref = buildReference(seed, d);
        const rng = new Rng(`${seed}-${d}`);
        for (const intent of ['valid', ...activeRules(d).map((r) => r.id)] as Intent[]) {
          expect(makeArrival(rng, ref, intent, '09:00'), `${seed} day ${d} ${intent}`).toBeDefined();
        }
      }
    }
  });

  it('lost teams leave the roster and the code list', () => {
    const lostId = campaignTeams('lost')[3]!.id;
    const ref = buildReference('lost', 4, { lost: [lostId] });
    expect(ref.roster.some((t) => t.id === lostId)).toBe(false);
    expect(ref.codes.some((c) => c.teamId === lostId)).toBe(false);
  });
});

describe('generated arrivals', () => {
  it('every arrival has exactly one correct answer: valid ones break nothing, hostile ones break exactly their rule', () => {
    let count = 0;
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      for (let d = 1; d <= MAX_DAY; d++) {
        const ref = buildReference(seed, d);
        const rng = new Rng(`arr-${seed}-${d}`);
        for (let i = 0; i < 60; i++) {
          const a = nextArrival(rng, ref, '09:00')!;
          expect(a).toBeDefined();
          const broken = brokenRules(a, ref);
          if (a.intent === 'valid') expect(broken).toEqual([]);
          else expect(broken).toEqual([a.intent]);
          // Only rules in force can be the reason.
          if (a.intent !== 'valid') expect(RULES.find((r) => r.id === a.intent)!.day).toBeLessThanOrEqual(d);
          expect(judge(a, ref).open).toBe(a.intent === 'valid');
          seen.add(`${d}:${a.intent}`);
          count++;
        }
      }
    }
    expect(count).toBe(SEEDS.length * MAX_DAY * 60);
    // Every rule actually comes up on its own day.
    for (const r of RULES) expect(seen.has(`${r.day}:${r.id}`), r.id).toBe(true);
  });

  it('before day 6, no arrival is a near-miss forgery (it would slip past the day-1 rule)', () => {
    for (const seed of SEEDS) {
      for (let d = 1; d < 6; d++) {
        const ref = buildReference(seed, d);
        const rng = new Rng(`nm-${seed}-${d}`);
        for (let i = 0; i < 60; i++) {
          const a = nextArrival(rng, ref, '09:00')!;
          if (!entryFor(a, ref)) expect(nearMiss(a.code, ref), `${seed} day ${d} ${a.code}`).toBeUndefined();
        }
      }
    }
  });

  it('explains every refusal in words', () => {
    const ref = buildReference('explain', 7);
    const rng = new Rng('explain');
    for (const r of RULES) {
      const a = makeArrival(rng, ref, r.id, '10:00')!;
      const v = judge(a, ref);
      expect(v.broken).toHaveLength(1);
      expect(v.broken[0]!.reason.length).toBeGreaterThan(10);
      expect(v.broken[0]!.reason).not.toMatch(/undefined|\{|\}/);
    }
  });
});
