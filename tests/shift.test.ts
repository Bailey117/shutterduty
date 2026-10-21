import { describe, expect, it } from 'vitest';
import { type Campaign, type KeyValueStorage, isFinished, load, newCampaign, recordShift, save } from '../src/game/campaign';
import { STORY_TEAM_ID } from '../src/game/reference';
import { judge } from '../src/game/rules';
import { type Decision, HOSTILE_LIMIT, type ShiftState, decide, report, shiftLength, startShift, timeLimit } from '../src/game/shift';

/** Play a shift to the end with a decision policy. */
function play(state: ShiftState, policy: (s: ShiftState) => Decision): ShiftState {
  let s = state;
  for (let i = 0; i < 200 && s.status === 'running'; i++) s = decide(s, policy(s)).state;
  return s;
}
const perfect = (s: ShiftState): Decision => (judge(s.current!, s.ref).open ? 'open' : 'close');

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('shift', () => {
  it('runs 4 to 10 arrivals, more on later days, and is replayable from its seed', () => {
    for (let d = 1; d <= 7; d++) {
      const a = play(startShift({ mode: 'campaign', seed: 'len', day: d, lost: [] }), perfect);
      const b = play(startShift({ mode: 'campaign', seed: 'len', day: d, lost: [] }), perfect);
      expect(a.results).toHaveLength(shiftLength(d));
      expect(a.results.length).toBeGreaterThanOrEqual(3);
      expect(a.results.length).toBeLessThanOrEqual(10);
      expect(b.results.map((r) => r.arrival)).toEqual(a.results.map((r) => r.arrival));
      expect(a.status).toBe('complete');
    }
  });

  it('perfect play is always correct and loses nothing', () => {
    for (let i = 0; i < 20; i++) {
      for (let d = 1; d <= 7; d++) {
        const s = play(startShift({ mode: 'campaign', seed: `p${i}`, day: d, lost: [] }), perfect);
        const r = report(s);
        expect(r.correct).toBe(r.calls);
        expect(r.friendliesLost).toEqual([]);
        expect(r.rating).toBe('Commended');
      }
    }
  });

  it('a timeout counts as leaving the shutter closed', () => {
    const s = startShift({ mode: 'campaign', seed: 'to', day: 1, lost: [] });
    const { result } = decide(s, 'timeout');
    expect(result.correct).toBe(!judge(s.current!, s.ref).open);
  });

  it('three hostiles admitted ends the shift', () => {
    const s = play(startShift({ mode: 'endless', seed: 'overrun', day: 7, lost: [] }), () => 'open');
    expect(s.status).toBe('overrun');
    expect(s.hostilesAdmitted).toBe(HOSTILE_LIMIT);
    expect(report(s).rating).toBe('Relieved of duty');
  });

  it('a refused friendly is lost and never seen again', () => {
    let s = startShift({ mode: 'campaign', seed: 'lose', day: 3, lost: [] });
    // Refuse everything: every genuine team that calls is lost.
    s = play(s, () => 'close');
    const lost = s.lost;
    expect(lost.length).toBeGreaterThan(0);
    for (const r of s.results) if (r.outcome === 'friendly-lost') expect(lost).toContain(r.arrival.teamId);
    const tomorrow = startShift({ mode: 'campaign', seed: 'lose', day: 4, lost });
    for (const id of lost) {
      expect(tomorrow.ref.roster.some((t) => t.id === id)).toBe(false);
      expect(tomorrow.ref.codes.some((c) => c.teamId === id)).toBe(false);
    }
  });

  it('the story arrivals come on days 5-7 with the right answer', () => {
    const want: Record<number, boolean> = { 5: false, 6: false, 7: true };
    for (const d of [5, 6, 7]) {
      let found = 0;
      for (let i = 0; i < 10; i++) {
        const s = play(startShift({ mode: 'campaign', seed: `story-${i}`, day: d, lost: [] }), perfect);
        for (const r of s.results.filter((x) => x.arrival.story)) {
          found++;
          expect(r.decision === 'open').toBe(want[d]);
        }
      }
      expect(found, `day ${d}`).toBeGreaterThan(5);
    }
    // If the story team was lost, the story falls silent instead of breaking.
    const s = play(startShift({ mode: 'campaign', seed: 'story-0', day: 7, lost: [STORY_TEAM_ID] }), perfect);
    expect(s.results.some((r) => r.arrival.story && r.arrival.teamId === STORY_TEAM_ID)).toBe(false);
  });

  it('the clock: 10 seconds on day 1, shorter later; endless speeds up', () => {
    const c = (day: number) => timeLimit({ config: { mode: 'campaign', seed: 'x', day, lost: [] }, results: [] });
    expect(c(1)).toBe(10);
    expect(c(7)).toBeLessThan(c(1));
    const e = startShift({ mode: 'endless', seed: 'e', day: 7, lost: [] });
    const later = play(e, perfect);
    expect(later.results.at(-1)!.limit).toBeLessThan(later.results[0]!.limit);
  });
});

describe('campaign', () => {
  it('advances a day per completed shift, repeats an overrun one, and keeps lost teams', () => {
    let c: Campaign = newCampaign('camp');
    const s1 = play(startShift({ mode: 'campaign', seed: c.seed, day: c.day, lost: c.lost }), () => 'close');
    c = recordShift(c, s1);
    expect(c.day).toBe(2);
    expect(c.lost).toEqual(s1.lost);
    const over = { ...s1, status: 'overrun' as const };
    expect(recordShift(c, { ...over, config: { ...over.config, day: 2 } }).day).toBe(2);
    for (let d = c.day; d <= 7; d++) c = recordShift(c, play(startShift({ mode: 'campaign', seed: c.seed, day: c.day, lost: c.lost }), perfect));
    expect(isFinished(c)).toBe(true);
  });

  it('keeps the best endless score', () => {
    let c = newCampaign('end');
    const run = play(startShift({ mode: 'endless', seed: 'abc', day: 7, lost: [] }), (s) => (s.results.length < 12 ? perfect(s) : 'open'));
    c = recordShift(c, run);
    expect(c.endlessBest).toEqual({ score: report(run).correct, seed: 'abc' });
    const worse = play(startShift({ mode: 'endless', seed: 'zzz', day: 7, lost: [] }), () => 'open');
    expect(recordShift(c, worse).endlessBest).toEqual(c.endlessBest);
  });

  it('saves and loads, and rejects a damaged save', () => {
    const st = memory();
    expect(load(st)).toEqual({ kind: 'none' });
    const c = { ...newCampaign('save'), day: 4, lost: ['t3'] };
    expect(save(st, c)).toBe(true);
    expect(load(st)).toEqual({ kind: 'ok', campaign: c });
    st.setItem('shutter-duty.save.v1', '{"version":1,"seed":"x","day":99}');
    expect(load(st).kind).toBe('corrupt');
    st.setItem('shutter-duty.save.v1', 'not json');
    expect(load(st).kind).toBe('corrupt');
  });
});
