import { describe, expect, it } from 'vitest';
import { brokenRules } from '../src/game/arrivals';
import { CITATION_FINE, FREE_CITATIONS, HOSTILE_FINE, WAGE, bills, night, shiftPay, startingHousehold } from '../src/game/economy';
import { compare } from '../src/game/inspect';
import { ALL_RULES, judge } from '../src/game/rules';
import { type ShiftState, DESK_RULES, HOSTILE_LIMIT, SHIFT_END, callNext, decide, setClock, startShift } from '../src/game/shift';

const SEEDS = Array.from({ length: 30 }, (_, i) => `desk-${i}`);

/** Every arrival a desk shift would produce, if each took `step` minutes. */
function arrivals(seed: string, step = 15) {
  let s: ShiftState = startShift({ mode: 'desk', seed, day: 0, lost: [] });
  const out = [];
  for (let i = 0; i < 80 && s.status === 'running'; i++) {
    s = callNext(setClock(s, s.clock + step));
    if (!s.current) break;
    out.push({ a: s.current, ref: s.ref });
    s = decide(s, judge(s.current, s.ref).open ? 'open' : 'close').state;
  }
  return { out, final: s };
}

describe('desk day', () => {
  it('every arrival has exactly one correct answer, and the voice checks come up', () => {
    let voiced = 0;
    let total = 0;
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      for (const { a, ref } of arrivals(seed).out) {
        expect(ref.rules).toEqual(DESK_RULES);
        const broken = brokenRules(a, ref);
        expect(broken).toEqual(a.intent === 'valid' ? [] : [a.intent]);
        if (a.voice) {
          voiced++;
          expect(a.voice.text).toContain(a.voice.speaker);
          expect(a.voice.text).not.toMatch(/\{|\}/);
        }
        seen.add(a.intent);
        total++;
      }
    }
    for (const id of ['valid', ...DESK_RULES]) expect(seen.has(id), id).toBe(true);
    expect(voiced / total).toBeGreaterThan(0.35);
    expect(voiced / total).toBeLessThan(0.85);
  });

  it('runs on the clock: arrivals keep coming until 18:00, then the shift ends', () => {
    const { out, final } = arrivals('clock', 20);
    expect(final.status).toBe('complete');
    expect(final.clock).toBe(SHIFT_END);
    expect(out.length).toBeGreaterThan(20);
    // Times stamped on arrivals follow the clock.
    const times = out.map((x) => x.a.time);
    expect([...times].sort()).toEqual(times);
  });

  it('three hostiles through ends the shift early', () => {
    let s: ShiftState = startShift({ mode: 'desk', seed: 'overrun', day: 0, lost: [] });
    for (let i = 0; i < 60 && s.status === 'running'; i++) {
      s = callNext(setClock(s, s.clock + 5));
      if (!s.current) break;
      s = decide(s, 'open').state;
    }
    expect(s.status).toBe('overrun');
    expect(s.hostilesAdmitted).toBe(HOSTILE_LIMIT);
  });
});

describe('inspection', () => {
  it("each hostile arrival's evidence shows a mismatch; a genuine one's evidence all matches", () => {
    for (const seed of SEEDS) {
      for (const { a, ref } of arrivals(seed).out) {
        const rules = ALL_RULES.filter((r) => ref.rules.includes(r.id));
        for (const r of rules) {
          const ev = r.evidence(a, ref);
          if (!ev) continue;
          const f = compare(ev[0], ev[1], a, ref);
          if (a.intent === r.id) expect(f.result, `${r.id}: ${f.text}`).toBe('mismatch');
          if (a.intent === 'valid') expect(f.result, `${r.id}: ${f.text}`).toBe('match');
          expect(f.text).not.toMatch(/undefined|\{|\}/);
        }
        if (a.intent !== 'valid') expect(rules.find((r) => r.id === a.intent)!.evidence(a, ref)).not.toBeNull();
      }
    }
  });

  it('unrelated fields say so', () => {
    const { out } = arrivals('unrelated');
    const { a, ref } = out[0]!;
    expect(compare('tx.code', 'tx.date', a, ref).result).toBe('unrelated');
    expect(compare('tx.code', 'tx.code', a, ref).result).toBe('unrelated');
    expect(compare('tx.code', 'nonsense.x', a, ref).result).toBe('unrelated');
  });
});

describe('pay and home', () => {
  const r = (correct: boolean, outcome: 'admitted' | 'refused' | 'hostile-admitted' | 'friendly-lost') => ({ correct, outcome }) as never;

  it('pays per correct call; the first two citations are warnings', () => {
    expect(shiftPay([r(true, 'admitted'), r(true, 'refused')]).total).toBe(2 * WAGE);
    const p = shiftPay([r(true, 'admitted'), r(false, 'friendly-lost'), r(false, 'friendly-lost'), r(false, 'friendly-lost'), r(false, 'hostile-admitted')]);
    expect(p.citations).toBe(4);
    expect(p.fines).toBe((4 - FREE_CITATIONS) * CITATION_FINE + HOSTILE_FINE);
    expect(p.total).toBe(WAGE - p.fines);
  });

  it('bills: rent always comes off; medicine only when someone is sick', () => {
    const h = startingHousehold();
    expect(bills(h).map((b) => b.id)).toContain('medicine');
    const n = night(h, { correct: 0, wages: 0, citations: 0, fines: 0, total: 0 }, []);
    expect(n.household.savings).toBe(h.savings - 20);
    expect(bills({ ...h, people: h.people.map((p) => ({ ...p, condition: 'well' as const })) }).map((b) => b.id)).not.toContain('medicine');
  });

  it('what is not paid for shows up in the morning', () => {
    const h = startingHousehold();
    const pay = { correct: 10, wages: 50, citations: 0, fines: 0, total: 50 };
    const all = night(h, pay, ['food', 'heat', 'medicine']);
    expect(all.household.people.every((p) => p.condition === 'well')).toBe(true);
    const none = night(h, pay, []);
    expect(none.household.people.find((p) => p.name === 'Pim')!.condition).toBe('gone');
    expect(none.household.people.find((p) => p.name === 'Corran')!.condition).toBe('sick');
    expect(none.morning.length).toBeGreaterThan(0);
  });
});
