import { describe, expect, it } from 'vitest';
import { brokenRules } from '../src/game/arrivals';
import { DEBT_LIMIT, type KeyValueStorage, SAVE_KEY, endDay, epilogue, load, newCampaign, recordEndless, save } from '../src/game/campaign';
import { CITATION_FINE, EXTRAS, FREE_CITATIONS, HOSTILE_FINE, WAGE, bills, night, shiftPay, startingHousehold } from '../src/game/economy';
import { compare } from '../src/game/inspect';
import { STORY_TEAM_ID } from '../src/game/reference';
import { ALL_RULES, MAX_DAY, activeRules, judge } from '../src/game/rules';
import { type Decision, HOSTILE_LIMIT, SHIFT_END, STORY_AFTER, type ShiftState, callNext, decide, setClock, startShift } from '../src/game/shift';

const SEEDS = Array.from({ length: 20 }, (_, i) => `camp-${i}`);
const perfect = (s: ShiftState): Decision => (judge(s.current!, s.ref).open ? 'open' : 'close');

/** Play a shift on the clock, `step` game minutes per arrival. */
function play(start: ShiftState, policy: (s: ShiftState) => Decision = perfect, step = 25) {
  let s = start;
  const seen: { a: NonNullable<ShiftState['current']>; ref: ShiftState['ref'] }[] = [];
  for (let i = 0; i < 400 && s.status === 'running'; i++) {
    s = callNext(setClock(s, s.clock + step));
    if (!s.current) break;
    seen.push({ a: s.current, ref: s.ref });
    s = decide(s, policy(s)).state;
  }
  return { s, seen };
}
const day = (seed: string, d: number, lost: string[] = []) => startShift({ mode: 'campaign', seed, day: d, lost });

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('campaign days', () => {
  it('every arrival on every day has exactly one correct answer under that day\'s orders', () => {
    const seen = new Set<string>();
    let voiced = 0;
    let total = 0;
    for (const seed of SEEDS) {
      for (let d = 1; d <= MAX_DAY; d++) {
        for (const { a, ref } of play(day(seed, d)).seen) {
          expect(ref.rules).toEqual(activeRules(d).map((r) => r.id));
          expect(brokenRules(a, ref)).toEqual(a.intent === 'valid' ? [] : [a.intent]);
          if (a.voice) {
            expect(d).toBeGreaterThanOrEqual(4);
            expect(a.voice.text).not.toMatch(/\{|\}/);
            voiced++;
          }
          if (d >= 4) total++;
          seen.add(`${d}:${a.intent}`);
        }
      }
    }
    // Each day's new orders really come up that day.
    for (const r of ALL_RULES) expect(seen.has(`${r.day}:${r.id}`), `${r.id} on day ${r.day}`).toBe(true);
    expect(voiced / total).toBeGreaterThan(0.35);
  });

  it("inspection: each hostile's evidence shows a mismatch, a genuine arrival's all match", () => {
    for (const seed of SEEDS.slice(0, 8)) {
      for (let d = 1; d <= MAX_DAY; d++) {
        for (const { a, ref } of play(day(seed, d)).seen) {
          for (const r of activeRules(d)) {
            const ev = r.evidence(a, ref);
            if (!ev) continue;
            const f = compare(ev[0], ev[1], a, ref);
            if (a.intent === r.id) expect(f.result, `${r.id}: ${f.text}`).toBe('mismatch');
            if (a.intent === 'valid') expect(f.result, `${r.id}: ${f.text}`).toBe('match');
          }
          // Every rule but recalls (read from the bulletin times) can be shown by inspection.
          if (a.intent !== 'valid' && a.intent !== 'recalled') expect(ALL_RULES.find((r) => r.id === a.intent)!.evidence(a, ref)).not.toBeNull();
        }
      }
    }
  });

  it('a shift runs 08:00 to 18:00 and is replayable from its seed', () => {
    const a = play(day('clock', 4));
    const b = play(day('clock', 4));
    expect(a.s.status).toBe('complete');
    expect(a.s.clock).toBe(SHIFT_END);
    expect(b.seen.map((x) => x.a)).toEqual(a.seen.map((x) => x.a));
    const times = a.seen.map((x) => x.a.time);
    expect([...times].sort()).toEqual(times);
  });

  it('three hostiles through ends the shift', () => {
    const { s } = play(day('overrun', 7), () => 'open', 10);
    expect(s.status).toBe('overrun');
    expect(s.hostilesAdmitted).toBe(HOSTILE_LIMIT);
  });

  it('a refused friendly is lost from every later roster, code list and mission log', () => {
    const { s } = play(day('lose', 4), () => 'close');
    expect(s.lost.length).toBeGreaterThan(0);
    const next = day('lose', 5, s.lost);
    for (const id of s.lost) {
      expect(next.ref.roster.some((t) => t.id === id)).toBe(false);
      expect(next.ref.codes.some((c) => c.teamId === id)).toBe(false);
      expect(next.ref.missions.some((m) => m.teamId === id)).toBe(false);
    }
  });

  it('the story arrives after noon on days 5-7, with the right answer', () => {
    const want: Record<number, boolean> = { 5: false, 6: false, 7: true };
    for (const d of [5, 6, 7]) {
      let found = 0;
      for (const seed of SEEDS.slice(0, 10)) {
        for (const { a, ref } of play(day(seed, d)).seen.filter((x) => x.a.story)) {
          found++;
          expect(a.time >= '12:00').toBe(true);
          expect(judge(a, ref).open).toBe(want[d]);
        }
      }
      expect(found, `day ${d}`).toBeGreaterThan(5);
    }
    expect(STORY_AFTER).toBe(12 * 60);
  });
});

describe('endless', () => {
  it('uses every order, keeps going past 18:00, and ends only when overrun', () => {
    const start = startShift({ mode: 'endless', seed: 'e', day: 1, lost: [] });
    expect(start.ref.rules).toEqual(ALL_RULES.map((r) => r.id));
    const { s } = play(start, (x) => (x.results.length < 40 ? perfect(x) : 'open'), 20);
    expect(s.clock).toBeGreaterThan(SHIFT_END);
    expect(s.status).toBe('overrun');
    const c = recordEndless(newCampaign('x'), s);
    expect(c.endlessBest).toEqual({ score: s.results.filter((x) => x.correct).length, seed: 'e' });
    expect(c.endlessBest!.score).toBeGreaterThanOrEqual(40);
    expect(recordEndless(c, play(startShift({ mode: 'endless', seed: 'f', day: 1, lost: [] }), () => 'open').s).endlessBest).toEqual(c.endlessBest);
  });
});

describe('pay and home', () => {
  const r = (correct: boolean, outcome: string) => ({ correct, outcome }) as never;

  it('pays per correct call; two warnings, then docked; a breach always docked', () => {
    expect(shiftPay([r(true, 'admitted'), r(true, 'refused')]).total).toBe(2 * WAGE);
    const p = shiftPay([r(true, 'admitted'), r(false, 'friendly-lost'), r(false, 'friendly-lost'), r(false, 'friendly-lost'), r(false, 'hostile-admitted')]);
    expect(p.fines).toBe((4 - FREE_CITATIONS) * CITATION_FINE + HOSTILE_FINE);
  });

  it('what is not paid for shows up in the morning', () => {
    const h = startingHousehold();
    const pay = { correct: 10, wages: 50, citations: 0, fines: 0, total: 50 };
    expect(night(h, pay, ['food', 'heat', 'medicine']).household.people.every((p) => p.condition === 'well')).toBe(true);
    const none = night(h, pay, []);
    expect(none.household.people.find((p) => p.name === 'Pim')!.condition).toBe('gone');
    expect(none.household.savings).toBe(h.savings + 50 - 20);
  });

  it('some evenings bring a one-off cost, remembered in the morning', () => {
    const h = startingHousehold();
    for (const [d, e] of Object.entries(EXTRAS)) {
      expect(bills(h, Number(d)).map((b) => b.id)).toContain(e.bill.id);
      const pay = { correct: 10, wages: 50, citations: 0, fines: 0, total: 50 };
      expect(night(h, pay, ['food', 'heat', e.bill.id], Number(d)).morning).toContain(e.yes);
      expect(night(h, pay, ['food', 'heat'], Number(d)).morning).toContain(e.no);
    }
    expect(bills(h, 1).map((b) => b.id)).not.toContain('gift');
  });
});

describe('the campaign', () => {
  it('runs seven days, carrying the household and lost teams, then ends with an epilogue', () => {
    let c = newCampaign('whole');
    for (let d = 1; d <= MAX_DAY; d++) {
      expect(c.day).toBe(d);
      const { s } = play(day(c.seed, c.day, c.lost));
      const end = endDay(c, s, ['food', 'heat', 'medicine']);
      expect(end.pay.total).toBeGreaterThan(0);
      c = end.campaign;
    }
    expect(c.status).toBe('complete');
    expect(c.story).toBe('home');
    expect(epilogue(c).join(' ')).toContain('walked down the ramp');
  });

  it('an overrun day pays nothing and must be worked again', () => {
    const c = newCampaign('over');
    const { s } = play(day(c.seed, 1), () => 'open', 10);
    expect(s.status).toBe('overrun');
    const end = endDay(c, s, []);
    expect(end.pay.wages).toBe(0);
    expect(end.campaign.day).toBe(1);
  });

  it('shutting the iris on the story team on day 7 is remembered', () => {
    let c = { ...newCampaign('cold'), day: MAX_DAY };
    const { s } = play(day(c.seed, MAX_DAY), (x) => (x.current!.story ? 'close' : perfect(x)));
    c = endDay(c, s, []).campaign;
    expect(c.story).toBe('shut-out');
    // ...and if the story team was lost earlier, it never calls.
    const silent = play(day('cold', MAX_DAY, [STORY_TEAM_ID]));
    expect(endDay({ ...newCampaign('cold'), day: MAX_DAY }, silent.s, []).campaign.story).toBe('silent');
  });

  it('too deep in debt and you are evicted', () => {
    const c = { ...newCampaign('debt'), household: { ...startingHousehold(), savings: DEBT_LIMIT + 5 } };
    const { s } = play(day(c.seed, 1), () => 'close');
    const end = endDay(c, s, ['food', 'heat', 'medicine']);
    expect(end.campaign.household.savings).toBeLessThan(DEBT_LIMIT);
    expect(end.campaign.status).toBe('evicted');
    expect(epilogue(end.campaign)[0]).toContain('quartermaster');
  });

  it('saves and loads; rejects a damaged or old save', () => {
    const st = memory();
    expect(load(st)).toEqual({ kind: 'none' });
    const c = { ...newCampaign('save'), day: 4, lost: ['t3'] };
    expect(save(st, c)).toBe(true);
    expect(load(st)).toEqual({ kind: 'ok', campaign: c });
    st.setItem(SAVE_KEY, JSON.stringify({ ...c, version: 1 }));
    expect(load(st)).toEqual({ kind: 'corrupt', reason: 'from an older version' });
    st.setItem(SAVE_KEY, 'not json');
    expect(load(st).kind).toBe('corrupt');
  });
});
